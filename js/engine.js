// Core Mathematical Engine logic
// Daily Interest, Min Payment formulas, Waterfall, Compounding

const clamp = (v, min = 0) => Math.max(min, v);

export function calculateDailyInterestRate(aprPercent) {
    return (aprPercent || 0) / 100 / 365;
}

export function calculateMonthlyInterest(balance, aprPercent) {
    return (balance || 0) * ((aprPercent || 0) / 100) / 12;
}

export function calculateMinPayment(balance, minPayType, minPayVal, interestAmount) {
    let raw = 0;
    const val = Number(minPayVal) || 0;

    if (minPayType === 'fixed') {
        raw = val;
    } else if (minPayType === 'percentage_balance') {
        // e.g. 2.5% of the total balance
        raw = (balance || 0) * (val / 100);
    } else {
        // Default: percentage_plus_interest (Interest + 1% of Balance)
        // Check if type is passed as val for backward compatibility or default to this
        const principalPortion = (balance || 0) * (val / 100);
        raw = (interestAmount || 0) + principalPortion;
    }

    const floored = Math.max(raw, 5); // hard floor of £5/$5
    // However, if balance is less than floor, we just pay the balance + interest (clearing it)
    // Actually, min payment is usually capped at the total balance
    return clamp(Math.min(floored, balance + (interestAmount||0)), 0);
}

function sortDebtsForStrategy(segments, strategy) {
    if (strategy === 'avalanche') {
        const sorted = segments.sort((a, b) => (b.apr || 0) - (a.apr || 0));
        return sorted;
    }
    if (strategy === 'highest-interest-amount') {
        // Prioritize segment generating the most interest (balance * apr)
        // Helps tackle "big scary numbers" even if APR is slightly lower than highest
        return segments.sort((a, b) => {
            const interestA = (a.balance || 0) * (a.apr || 0);
            const interestB = (b.balance || 0) * (b.apr || 0);
            return interestB - interestA;
        });
    }
    // Default: snowball
    return segments.sort((a, b) => (a.balance || 0) - (b.balance || 0));
}

export function compareStrategies(state, strategies = ['avalanche', 'snowball', 'highest-interest-amount']) {
    const results = [];
    strategies.forEach(strat => {
        // Clone state to avoid mutation
        const cleanState = JSON.parse(JSON.stringify(state));
        cleanState.strategy = strat;
        const sim = runSimulation(cleanState, { maxMonths: 600 });
        results.push({
            strategy: strat,
            totalInterest: sim.totalInterest,
            payoffMonth: sim.payoffMonth
        });
    });
    // Sort by total interest ascending (best first)
    return results.sort((a, b) => a.totalInterest - b.totalInterest);
}

export function runSimulation(state, options = {}) {
    // state: { groups: [{ id, name, minPayType, minPayVal, segments: [{ id, name, balance, apr }] }], windfalls: [{month, amount}], btOffers: [...] , monthlyBudget, strategy }
    const maxMonths = options.maxMonths || 600;
    const results = {
        months: [],
        totalInterest: 0,
        payoffMonth: null,
        interestSavedFromBT: 0,
        initialBalance: 0,
        totalFees: 0
    };

    // Clone balances
    const segs = [];
    state.groups = state.groups || [];
    state.groups.forEach((g, gi) => {
        (g.segments || []).forEach((s, si) => {
            segs.push({
                groupId: gi,
                groupName: g.name || `Card ${gi + 1}`,
                minPayType: g.minPayType || 'percentage',
                minPayVal: Number(g.minPayVal) || 1.0,
                id: s.id || `${gi}-${si}`,
                name: s.name || '',
                balance: Number(s.balance) || 0,
                apr: Number(s.apr) || 0,
                promoMonths: Number(s.promoMonths) || 0,
                postPromoApr: Number(s.postPromoApr) || 0,
                initialApr: Number(s.apr) || 0, // Store initial APR
            });
        });
    });

    results.initialDailyInterest = segs.reduce((acc, s) => acc + calculateDailyInterestRate(s.apr) * s.balance, 0);
    results.initialBalance = segs.reduce((acc, s) => acc + s.balance, 0);

    // Handle BT offers as objects: { cap, feePercent, promoApr, months, postPromoApr }
    const btOffers = (state.btOffers || [])
        .filter(o => o.enabled !== false)
        .map(o => ({...o}));

    let month = 0;
    while (month < maxMonths) {
        month += 1;

        // Update APR for segments where promo period has ended
        segs.forEach(s => {
            if (s.promoMonths > 0) {
                s.promoMonths -= 1;
                if (s.promoMonths === 0) {
                    s.apr = s.postPromoApr;
                }
            }
        });
        const monthRecord = { month, segments: [], openingTotal: 0, closingTotal: 0, windfall: 0, btActions: [] };

        // Opening balances & accrue interest for the month
        let openingTotal = 0;
        const interestBySeg = {};
        const openingInfo = [];
        segs.forEach(s => {
            const openingBal = s.balance;
            openingTotal += openingBal;
            const interest = calculateMonthlyInterest(openingBal, s.apr);
            s.balance += interest; // Accrue interest first
            interestBySeg[s.id] = interest;
            const min = calculateMinPayment(openingBal, s.minPayType, s.minPayVal, interest);
            const minPaid = Math.min(min, s.balance); // Pay against new balance
            openingInfo.push({ id: s.id, name: s.name, groupName: s.groupName, openingBalance: openingBal, apr: s.apr, interest, minPayment: min, minPaid });
        });
        monthRecord.openingTotal = openingTotal;
        monthRecord.interest = openingInfo.reduce((acc, i) => acc + i.interest, 0);
        results.totalInterest += monthRecord.interest;

        // Calculate minimum payments and deduct them first
        let minPaymentsTotal = 0;
        const paymentsMap = {}; // id -> { minPaid, extraPaid }
        openingInfo.forEach(info => {
            paymentsMap[info.id] = { minPaid: info.minPaid, extraPaid: 0 };
            const seg = segs.find(x => x.id === info.id);
            if (seg) seg.balance = clamp(seg.balance - info.minPaid);
            minPaymentsTotal += info.minPaid;
        });

        // Apply windfalls for this month (if any)
        let remainingWindfall = 0;
        (state.windfalls || []).forEach(w => {
            if ((w.month || 0) === month) remainingWindfall += Number(w.amount || 0);
        });
        monthRecord.windfall = remainingWindfall;

        // Apply Balance Transfer logic before applying extra payments
        // For each BT offer, fill capacity by pulling from highest APR debts
        btOffers.forEach(offer => {
            if (!offer.applied && month === 1) { // Only apply on the first month
                const cap = Number(offer.cap) || 0;
                if (cap <= 0) return;
                // sort segs by APR desc, then by balance desc (highest interest payment preference for ties)
                const sourceSegs = segs.filter(s => s.balance > 0 && s.apr > (Number(offer.promoApr) || 0))
                    .sort((a, b) => {
                        const aprDiff = (b.apr || 0) - (a.apr || 0);
                        if (Math.abs(aprDiff) > 0.0001) return aprDiff;
                        // If APRs are effectively equal, prioritize higher balance (higher interest payment)
                        return (b.balance || 0) - (a.balance || 0);
                    });
                let remainingCap = cap;
                for (const source of sourceSegs) {
                    if (remainingCap <= 0) break;
                    const take = Math.min(source.balance, remainingCap);
                    if (take <= 0) continue;
                    
                    // Estimate interest saved
                    const originalInterest = calculateMonthlyInterest(take, source.apr) * (Number(offer.months) || 0);
                    const promoInterest = calculateMonthlyInterest(take, Number(offer.promoApr) || 0) * (Number(offer.months) || 0);
                    results.interestSavedFromBT += (originalInterest - promoInterest);

                    source.balance -= take;
                    const fee = take * (Number(offer.feePercent||0)/100);
                    results.totalFees += fee;
                    const newBtSegmentId = `bt-${offer.id}-${month}`;
                    
                    // Log the action
                    monthRecord.btActions.push({
                        sourceCard: source.groupName,
                        sourceSegment: source.name,
                        amount: take,
                        destinationCard: offer.name || `BT ${offer.id}`,
                        fee: fee,
                        newBalance: take + fee
                    });

                    // create new segment representing BT balance with promo APR
                    segs.push({
                        groupId: `bt-${offer.id}`,
                        groupName: offer.name || `BT ${offer.id}`,
                        minPayType: offer.minPayType || 'percentage_balance',
                        minPayVal: Number(offer.minPayVal) || 1.0,
                        id: newBtSegmentId,
                        name: `BT from ${source.groupName}`,
                        balance: take + fee,
                        apr: Number(offer.promoApr) || 0,
                        promoMonths: Number(offer.months) || 0,
                        postPromoApr: Number(offer.postPromoApr) || source.apr, // Reverts to source APR if not specified
                    });
                    remainingCap -= take;
                }
                offer.applied = true;
            }
        });

        // Remaining budget after minimums
        let monthlyBudget = Number(state.monthlyBudget) || 0;
        let remainingBudget = clamp(monthlyBudget - minPaymentsTotal);
        
        // Add windfall to remaining budget
        let windfallThisMonth = 0;
        (state.windfalls || []).forEach(w => {
            if ((w.month || 0) === month) windfallThisMonth += Number(w.amount || 0);
        });
        monthRecord.windfall = windfallThisMonth;
        remainingBudget += windfallThisMonth;

        // Apply strategy payments to sorted debts
        const targets = sortDebtsForStrategy(segs.filter(s => s.balance > 0), state.strategy || 'avalanche');
        for (const t of targets) {
            if (remainingBudget <= 0) break;
            const pay = Math.min(t.balance, remainingBudget);
            t.balance = clamp(t.balance - pay);
            remainingBudget -= pay;
            paymentsMap[t.id] = paymentsMap[t.id] || { minPaid: 0, extraPaid: 0 };
            paymentsMap[t.id].extraPaid += pay;
        }

        // After payments, apply compounding: add monthly interest based on opening balances
        let interestThisMonth = 0;
        segs.forEach(s => {
            const interest = interestBySeg[s.id] || 0;
            // s.balance += interest; // Interest is now accrued before payments
            interestThisMonth += interest;
        });

        // monthRecord.interest = interestThisMonth;
        // results.totalInterest += interestThisMonth;

        // Capture per-segment snapshot
        monthRecord.openingSegments = openingInfo.map(i => ({ ...i }));
        monthRecord.segments = segs.map(s => ({ id: s.id, name: s.name, balance: Number(s.balance.toFixed(2)), apr: s.apr, groupId: s.groupId, groupName: s.groupName }));
        monthRecord.payments = paymentsMap;

        // Closing total
        const closingTotal = segs.reduce((acc,s)=>acc + s.balance, 0);
        monthRecord.closingTotal = closingTotal;

        results.months.push(monthRecord);

        // Check payoff
        const allZero = segs.every(s => s.balance <= 0.005);
        if (allZero) {
            results.payoffMonth = month;
            break;
        }
    }

    return results;
}

export function computeRequiredMinimums(state) {
    const segs = [];
    state.groups = state.groups || [];
    state.groups.forEach((g, gi) => {
        (g.segments || []).forEach((s, si) => {
            segs.push({
                minPayType: g.minPayType || 'percentage_plus_interest',
                minPayVal: Number(g.minPayVal) || 1.0,
                id: s.id || `${gi}-${si}`,
                balance: Number(s.balance) || 0,
                apr: Number(s.apr) || 0,
            });
        });
    });
    let totalMin = 0;
    segs.forEach(s => {
        const interest = calculateMonthlyInterest(s.balance, s.apr);
        const min = calculateMinPayment(s.balance, s.minPayType, s.minPayVal, interest);
        totalMin += Math.min(min, s.balance + interest);
    });
    return totalMin;
}

export default {
    calculateDailyInterestRate,
    calculateMonthlyInterest,
    calculateMinPayment,
    runSimulation,
    compareStrategies,
};
