import { runSimulation } from '../js/engine.js';
import assert from 'assert';
import { is, test } from './test_framework.js';

export const WaterfallScenarios = {
    safetyFloorPriority: () => ({
        monthlyBudget: 200, 
        strategy: 'avalanche',
        groups: [
            {
                id: 0,
                name: 'High APR Card (Healthy)',
                minPayType: 'fixed',
                minPayVal: 5,
                historicalPDMonths: 0,
                segments: [{ id: '0-0', balance: 1000, apr: 30 }] 
            },
            {
                id: 1,
                name: 'Low APR Card (Risk Stage 2)',
                minPayType: 'fixed',
                minPayVal: 5,
                historicalPDMonths: 30, 
                segments: [{ id: '1-0', balance: 5000, apr: 12 }] 
            }
        ]
    })
};

export const run = async () => {
    console.log('Running FCA Waterfall Priority Tests...\n');

    await test('FCA Waterfall: Prioritizes Safety Floor for Stage 2 accounts over Avalanche', () => {
        const s = WaterfallScenarios.safetyFloorPriority();
        const results = runSimulation(s, { maxMonths: 1 });
        
        const m1 = results.months[0];
        const payHealthy = m1.payments['0-0'];
        const payRisk = m1.payments['1-0'];
        
        // Card 0 (Healthy): 1000 @ 30%. Interest = 25. Min = 5. (Pay 5)
        // Card 1 (Risk): 5000 @ 12%. Interest = 50. Min = 5. (Pay 5)
        // Safety Floor for Card 1 = 50 + 50 + 1 = 101.
        
        // Total budget 200.
        // Priority 1: Pay 5 to Card 0, Pay 5 to Card 1. (Remaining = 190)
        // Priority 2 (FCA): Card 1 is Stage 2. Target = 101. Already paid 5. Need extra 96.
        // Priority 3 (Avalanche): Card 0 is 30% APR. Remaining budget (190 - 96 = 94) goes to Card 0.
        
        assert.strictEqual(payRisk.minPaid, 5, 'Card 1 min pay should be 5');
        assert.ok(payRisk.extraPaid >= 46, `Card 1 should get Priority 2 extra pay for safety floor (got ${payRisk.extraPaid})`);
        
        assert.strictEqual(payHealthy.minPaid, 5);
        // Avalanche got the rest
        is.greaterThan(payHealthy.extraPaid, 90, 'Card 0 should get Avalanche surplus AFTER Card 1 safety floor: {0} < {1}');
    });
};
