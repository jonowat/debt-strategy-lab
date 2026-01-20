// Core Mathematical Engine logic
// Daily Interest, Min Payment formulas, Waterfall, Compounding

const clamp = (v, min = 0) => Math.max(min, v);

export function calculateDailyInterestRate(aprPercent) {
    return (aprPercent || 0) / 100 / 365;
}

export function calculateMonthlyInterest(balance, aprPercent) {
    return (balance || 0) * ((aprPercent || 0) / 100) / 12;
}

export function calculateSafetyFloor(monthlyInterest) {
    // FCA: Minimum amount needed to flip the principal/interest ratio in a given month
    return (monthlyInterest || 0) * 2 + 1;
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
        const sorted = [...segments].sort((a, b) => (b.apr || 0) - (a.apr || 0));
        return sorted;
    }
    if (strategy === 'highest-interest-amount') {
        // Prioritize segment generating the most interest (balance * apr)
        // Helps tackle "big scary numbers" even if APR is slightly lower than highest
        return [...segments].sort((a, b) => {
            const interestA = (a.balance || 0) * (a.apr || 0);
            const interestB = (b.balance || 0) * (b.apr || 0);
            return interestB - interestA;
        });
    }
    if (strategy === 'tsunami') {
        // Sort by custom priority (1 = highest priority). 
        // We'll treat missing priority as lowest (infinity)
        return [...segments].sort((a, b) => {
            const pA = a.priority === undefined ? 999 : a.priority;
            const pB = b.priority === undefined ? 999 : b.priority;
            return pA - pB;
        });
    }
    // Default: snowball
    return [...segments].sort((a, b) => (a.balance || 0) - (b.balance || 0));
}

export function compareStrategies(state, strategies = ['avalanche', 'snowball', 'highest-interest-amount', 'tsunami', 'percentage-buffer', 'min-only']) {
    const results = [];
    strategies.forEach(strat => {
        // Clone state to avoid mutation
        const cleanState = JSON.parse(JSON.stringify(state));
        
        if (strat === 'min-only') {
            cleanState.monthlyBudget = 0; // Forced to minimums only
            cleanState.strategy = 'avalanche'; // Sorting doesn't matter for min-only
        } else if (strat === 'percentage-buffer') {
            cleanState.strategy = 'avalanche'; // Use avalanche for the extra
            cleanState.percentageBuffer = 0.10; // 10% extra
        } else {
            cleanState.strategy = strat;
        }

        const sim = runSimulation(cleanState, { maxMonths: 600 });
        
        // Human Metrics
        const years = Math.floor((sim.payoffMonth || 0) / 12);
        const months = (sim.payoffMonth || 0) % 12;
        
        results.push({
            strategy: strat,
            totalInterest: sim.totalInterest,
            payoffMonth: sim.payoffMonth,
            freedomLabel: sim.payoffMonth ? `${years > 0 ? `${years}y ` : ''}${months}m` : '30y+',
            timeToFirstZero: sim.timeToFirstZero || null,
            firstMonthInterestRatio: sim.firstMonthInterestRatio || 0
        });
    });

    // Strategy "Value" Scoring (Simple 1-10 based on interest savings vs baseline)
    const baseline = results.find(r => r.strategy === 'min-only')?.totalInterest || 1;
    results.forEach(r => {
        const savings = baseline - r.totalInterest;
        const score = Math.min(10, Math.max(1, Math.round((savings / baseline) * 20)));
        r.score = score;
    });

    return results;
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
        totalFees: 0,
        timeToFirstZero: null,
        firstMonthInterestRatio: null
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
                interestHistory: [], // FCA: Rolling history
                principalHistory: [], // FCA: Rolling history
                initialPDMonths: Number(g.historicalPDMonths) || 0 // FCA: Starting state
            });
        });
    });

    // Handle initial PD history pre-loading (Assumption: If starting in PD, history was bad)
    segs.forEach(s => {
        if (s.initialPDMonths > 0) {
            // Fill history with "bad" ratio (Principal 0, Interest 1) for the duration up to 18
            const monthsToFill = Math.min(s.initialPDMonths, 18);
            for (let i = 0; i < monthsToFill; i++) {
                s.interestHistory.push(1);
                s.principalHistory.push(0);
            }
        }
        s.currentPDMonths = s.initialPDMonths; // FCA: Init counter
    });

    results.initialDailyInterest = segs.reduce((acc, s) => acc + calculateDailyInterestRate(s.apr) * s.balance, 0);
    results.initialBalance = segs.reduce((acc, s) => acc + s.balance, 0);

    // Handle BT offers as objects: { cap, feePercent, promoApr, months, postPromoApr }
    const btOffers = (state.btOffers || [])
        .filter(o => o.enabled !== false)
        .map(o => ({...o}));
    
    // Start simulation from current month if using calendar mode
    const useCalendar = state.useCalendar !== false; // Default to true if undefined or allow explicit false? User wants toggle.
    // Actually, let's treat it as opt-in for now to match UI check, OR default true if we want modernization.
    // The UI checkbox defaults to unchecked in HTML. So let's respect that.
    
    const startDate = new Date();
    startDate.setDate(1);

    let month = 0;
    while (month < maxMonths) {
        month += 1;
        
        let daysInMonth = 30;
        let monthLabel = null;

        if (useCalendar) {
            // Determine actual month context for ADB days calculation
            const currentSimDate = new Date(startDate.getFullYear(), startDate.getMonth() + (month - 1), 1);
            daysInMonth = new Date(currentSimDate.getFullYear(), currentSimDate.getMonth() + 1, 0).getDate();
            
            // Format Label: "Jan 2026"
            const mo = currentSimDate.toLocaleString('default', { month: 'short' });
            const yr = currentSimDate.getFullYear();
            monthLabel = `${mo} ${yr}`;
        }
        
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
        let interestThisMonth = 0;
        const interestBySeg = {}; // Used just for Min Pay calculation estimate
        const openingInfo = [];
        segs.forEach(s => {
            const openingBal = s.balance;
            openingTotal += openingBal;

            // Simplified Interest Calculation: Balance * DailyRate * DaysInMonth
            const dailyRate = calculateDailyInterestRate(s.apr);
            const interest = openingBal * dailyRate * daysInMonth;
            
            s.balance += interest;
            interestThisMonth += interest;
            results.totalInterest += interest;

            interestBySeg[s.id] = interest;
            const min = calculateMinPayment(openingBal, s.minPayType, s.minPayVal, interest);
            const minPaid = Math.min(min, s.balance); // Pay against balance (which now includes interest)
            openingInfo.push({ id: s.id, name: s.name, groupName: s.groupName, openingBalance: openingBal, apr: s.apr, interest, minPayment: min, minPaid });
        });
        monthRecord.openingTotal = openingTotal;
        monthRecord.interest = interestThisMonth;

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
                let totalBtBalance = 0;
                let sourcesList = [];

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
                    const segmentBalance = take + fee;
                    totalBtBalance += segmentBalance;
                    sourcesList.push(source.groupName);

                    // Log the action
                    monthRecord.btActions.push({
                        sourceCard: source.groupName,
                        sourceSegment: source.name,
                        amount: take,
                        destinationCard: offer.name || `BT ${offer.id}`,
                        fee: fee,
                        newBalance: segmentBalance
                    });
                    remainingCap -= take;
                }

                if (totalBtBalance > 0) {
                     // create ONE new segment representing consolidated BT balance
                     const newBtSegmentId = `bt-${offer.id}-${month}`;
                     segs.push({
                        groupId: `bt-${offer.id}`,
                        groupName: offer.name || `BT ${offer.id}`,
                        minPayType: offer.minPayType || 'percentage_balance',
                        minPayVal: Number(offer.minPayVal) || 1.0,
                        id: newBtSegmentId,
                        name: `Transfer from ${sourcesList.join(', ')}`,
                        balance: totalBtBalance,
                        apr: Number(offer.promoApr) || 0,
                        promoMonths: Number(offer.months) || 0,
                        postPromoApr: Number(offer.postPromoApr) || 0,
                        interestHistory: [],
                        principalHistory: [],
                        currentPDMonths: 0,
                        isPersistentDebt: false
                    });
                }
                offer.applied = true;
            }
        });

        // Remaining budget after minimums
        let monthlyBudget = Number(state.monthlyBudget) || 0;
        
        // Percentage Buffer Strategy: Override budget to be Min + X%
        if (state.percentageBuffer) {
            monthlyBudget = minPaymentsTotal * (1 + state.percentageBuffer);
        }

        let remainingBudget = clamp(monthlyBudget - minPaymentsTotal);
        
        // Add windfall to remaining budget
        let windfallThisMonth = 0;
        (state.windfalls || []).forEach(w => {
            if ((w.month || 0) === month) windfallThisMonth += Number(w.amount || 0);
        });
        monthRecord.windfall = windfallThisMonth;
        remainingBudget += windfallThisMonth;

        // --- Priority 2: FCA Safety Floor ---
        // Apply extra payments to cards in Stage 2 (27+ months PD history) to meet safety floor
        const useFcaSafety = state.fcaSafetyMode !== false; // Default to true if not specified
        if (useFcaSafety) {
            segs.forEach(s => {
                // If card is already deep in PD (Stage 2: 27mo+)
                if (s.currentPDMonths >= 18){
                    if(remainingBudget > 0) {
                        const interest = interestBySeg[s.id] || 0;
                        const safetyFloor = calculateSafetyFloor(interest);
                        const currentPaid = paymentsMap[s.id]?.minPaid || 0;
                        
                        if (currentPaid < safetyFloor) {
                            const extraNeeded = safetyFloor - currentPaid;
                            const extraToPay = Math.min(extraNeeded, s.balance, remainingBudget);
                            
                            if (extraToPay > 0) {
                                s.balance = clamp(s.balance - extraToPay);
                                remainingBudget -= extraToPay;
                                paymentsMap[s.id].extraPaid += extraToPay;
                            }
                        }
                    }

                    // implement a warning here, or add a suggested action?
                    // suggest increating budget or switching strategy
                }
            });
        }

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


        // FCA: Update Rolling History and Check Status
        segs.forEach(s => {
            const payInfo = paymentsMap[s.id] || { minPaid: 0, extraPaid: 0 };
            const totalPay = payInfo.minPaid + payInfo.extraPaid;
            const interest = interestBySeg[s.id] || 0;
            const principalPaid = totalPay - interest;

            s.interestHistory.push(interest);
            s.principalHistory.push(principalPaid);

            if (s.interestHistory.length > 18) s.interestHistory.shift();
            if (s.principalHistory.length > 18) s.principalHistory.shift();

            const totalInt = s.interestHistory.reduce((a,b)=>a+b,0);
            const totalPrin = s.principalHistory.reduce((a,b)=>a+b,0);

            // Only flag if there is history and non-zero balance (or we are just paying it off)
            s.isPersistentDebt = (totalInt > totalPrin) && (s.balance > 0.01); 
            if (s.isPersistentDebt) {
                 s.currentPDMonths += 1;
            } else {
                 s.currentPDMonths = 0;
            }
        });

        // Capture per-segment snapshot
        monthRecord.openingSegments = openingInfo.map(i => ({ ...i }));
        monthRecord.segments = segs.map(s => ({ 
            id: s.id, 
            name: s.name, 
            balance: Number(s.balance.toFixed(2)), 
            apr: s.apr, 
            groupId: s.groupId, 
            groupName: s.groupName,
            pdMonths: s.currentPDMonths, // FCA Status
            isPersistentDebt: s.isPersistentDebt // FCA Flag
        }));
        monthRecord.payments = paymentsMap;
        monthRecord.label = monthLabel; // Store formatted label

        // Closing total
        const closingTotal = segs.reduce((acc,s)=>acc + s.balance, 0);
        monthRecord.closingTotal = closingTotal;

        results.months.push(monthRecord);

        // Tracking first zero (psychological win)
        const hasAZero = segs.some(s => s.balance <= 0.005);
        if (hasAZero && results.timeToFirstZero === null) {
            results.timeToFirstZero = month;
        }

        // Tracking first month interest ratio (human cost)
        if (month === 1) {
            const totalMonthlyInterest = monthRecord.interest;
            const totalMonthlyPayments = Object.values(paymentsMap).reduce((acc, p) => acc + p.minPaid + p.extraPaid, 0);
            results.firstMonthInterestRatio = totalMonthlyPayments > 0 ? (totalMonthlyInterest / totalMonthlyPayments) : 0;
        }

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
