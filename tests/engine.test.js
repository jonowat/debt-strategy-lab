
import { calculateMinPayment, runSimulation, calculateMonthlyInterest, calculateDailyInterestRate } from '../js/engine.js';
import assert from 'assert';
import { test } from './test_framework.js';

export const Scenarios = {
    simpleCard: () => ({
        monthlyBudget: 100,
        strategy: 'avalanche',
        groups: [{
            id: 0,
            name: 'Test Card',
            minPayType: 'percentage_plus_interest',
            minPayVal: 1.0,
            segments: [{
                id: '0-0',
                name: 'Purchase',
                balance: 1000,
                apr: 20,
                hasPromo: false
            }]
        }],
        btOffers: [],
        windfalls: []
    }),
    
    multiCardSnowball: () => ({
        monthlyBudget: 200,
        strategy: 'snowball',
        groups: [{
            id: 0,
            name: 'Small Balance',
            segments: [{ id: '0-0', balance: 500, apr: 10 }]
        }, {
            id: 1,
            name: 'High APR',
            segments: [{ id: '1-0', balance: 2000, apr: 25 }]
        }]
    }),

    btScenario: () => ({
        monthlyBudget: 200,
        strategy: 'avalanche',
        groups: [{
            id: 0,
            name: 'Chase',
            segments: [{ id: '0-0', balance: 2000, apr: 24 }]
        }],
        btOffers: [{
            id: 'offer1',
            name: 'BT Offer',
            cap: 3000,
            feePercent: 3,
            promoApr: 0,
            months: 12,
            minPayType: 'percentage_balance',
            minPayVal: 1.0,
            applied: false
        }]
    }),

    testScenario: {
        monthlyBudget: 300,
        strategy: 'avalanche',
        groups: [
            {
                id: 0,
                name: 'Source 1',
                minPayType: 'percentage_plus_interest',
                minPayVal: 1,
                segments: [{ id: '0-0', balance: 1000, apr: 20 }]
            },
            {
                id: 1,
                name: 'Source 2',
                minPayType: 'percentage_plus_interest',
                minPayVal: 1,
                segments: [{ id: '1-0', balance: 2000, apr: 25 }]
            }
        ],
        btOffers: [{
            id: 'bt-offer',
            name: 'Big BT',
            cap: 5000,
            feePercent: 0,
            promoApr: 0,
            months: 24,
            postPromoApr: 20,
            minPayType: 'fixed',
            minPayVal: 150,
            enabled: true
        }],
        windfalls: []
    }
};

// --- Tests ---

console.log('Running Engine Tests...\n');

export const run = async () => {
    console.log('Running Engine Tests...\n');

    await test('calculateMinPayment: percentage_plus_interest', () => {
        // 1000 balance, 1% repayment + interest. 
        // Say interest is 10.
        // 10 + (1000 * 0.01) = 20
        const val = calculateMinPayment(1000, 'percentage_plus_interest', 1.0, 10);
        assert.strictEqual(val, 20);
    });

    await test('calculateMinPayment: percentage_balance', () => {
        // 1000 balance, 2% of balance
        // 1000 * 0.02 = 20
        const val = calculateMinPayment(1000, 'percentage_balance', 2.0, 10);
        assert.strictEqual(val, 20);
    });

    await test('calculateMinPayment: fixed', () => {
        // Fixed 50
        const val = calculateMinPayment(1000, 'fixed', 50, 10);
        assert.strictEqual(val, 50);
    });

    await test('calculateMinPayment: floor behavior', () => {
        // Calculated is 1, floor is 5
        const val = calculateMinPayment(100, 'percentage_balance', 1.0, 0);
        assert.strictEqual(val, 5, 'Should apply £5 floor');
    });

    await test('calculateMinPayment: full payoff if below floor', () => {
        // Balance is 3, calculated min is 5. Should strictly pay 3 + interest
        const interest = 0.5;
        const balance = 3;
        const val = calculateMinPayment(balance, 'fixed', 50, interest);
        assert.ok(Math.abs(val - 3.5) < 0.001, `Should pay exact balance+interest (${val})`);
    });

    await test('Simulation: Single card payoff', () => {
        const s = Scenarios.simpleCard();
        // APR 20% -> 1.66% monthly -> ~16.6 interest first month
        // Min pay roughly: 16.6 + 10 = 26.6
        // Budget 100 available.
        // Should pay 100.
        const results = runSimulation(s);
        
        assert.ok(results.payoffMonth > 0, 'Should have a payoff month');
        assert.ok(results.payoffMonth < 24, 'Should pay off in roughly a year');
        assert.strictEqual(results.months[0].closingTotal < 1000, true, 'Balance should decrease');
    });

    await test('Simulation: Snowball Strategy', () => {
        const s = Scenarios.multiCardSnowball();
        // 500 debt vs 2000 debt. Snowball targets 500 first.
        const results = runSimulation(s);
        
        const m1 = results.months[0];
        const p0 = m1.payments['0-0'].extraPaid;
        const p1 = m1.payments['1-0'].extraPaid;
        
        assert.ok(p0 > p1, 'Snowball should prioritize lower balance (id 0-0)');
    });

    await test('Simulation: BT Application', () => {
        const s = Scenarios.btScenario();
        const results = runSimulation(s);
        
        // Check if new BT segment was created
        const btSeg = results.months[0].segments.find(seg => String(seg.groupId).startsWith('bt-'));
        assert.ok(btSeg, 'Should create a BT segment');
        
        // Check transfer happened
        // Original segment should be empty (or near empty)
        const sourceSeg = results.months[0].segments.find(seg => !String(seg.groupId).startsWith('bt-'));
        assert.ok(sourceSeg.balance < 1, 'Source segment should be cleared (transferred)');

        // BT Balance logic is complex (interacts with min payments), just ensure it's significant
        assert.ok(btSeg.balance > 1500, 'BT Balance should hold the transferred debt');
    });


    await test('Large balance transfer scenario', () => {
        const s = Scenarios.testScenario;
        const results = runSimulation(s);
        // console.log('DEBUG Segments:', results.months[1].segments);
        assert.ok(results.payoffMonth > 0, 'Should have a payoff month');
        assert.ok(results.payoffMonth < 100, 'Should pay off in under 100 months');
        
        // Check active segments (balance > £1)
        const activeSegments = results.months[1].segments.filter(s => s.balance > 1);
        
        // Should verify that the ONLY active segment is the BT segment
        assert.strictEqual(activeSegments.length, 1, `Should have consolidated to one active segment. Found ${activeSegments.length}: ${activeSegments.map(s => `${s.name} (£${s.balance.toFixed(2)})`).join(', ')}`);
        assert.ok(String(activeSegments[0].groupId).startsWith('bt-'), 'The active segment should be the BT segment');
    });
};



