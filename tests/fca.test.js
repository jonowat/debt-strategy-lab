import { runSimulation } from '../js/engine.js';
import assert from 'assert';
import { test } from './test_framework.js';

export const FCAScenarios = {
    highInterestDebt: () => ({
        monthlyBudget: 100, // Enough to cover min, but not clear debt fast
        strategy: 'avalanche',
        groups: [{
            id: 0,
            name: 'Problem Card',
            minPayType: 'percentage_plus_interest',
            minPayVal: 1.0, // 1% + Interest
            historicalPDMonths: 0,
            segments: [{
                id: '0-0',
                name: 'Purchase',
                balance: 5000,
                apr: 39.9, // High APR
                hasPromo: false
            }]
        }],
        btOffers: [],
        windfalls: []
    }),
    
    existingPD: () => ({
        monthlyBudget: 70, // Just barely covers minimum (~69.83)
        strategy: 'avalanche',
        groups: [{
            id: 0,
            name: 'Existing PD Card',
            historicalPDMonths: 17, // On the brink of Stage 1
            segments: [{ id: '0-0', balance: 2000, apr: 29.9 }]
        }]
    })
};

console.log('Running FCA Compliance Tests...\n');

test('FCA: Tracks Interest vs Principal History', () => {
    const s = FCAScenarios.highInterestDebt();
    const results = runSimulation(s, { maxMonths: 24 });
    const m18 = results.months[17];
    
    // We expect the segment objects in the results to now have FCA data
    const seg = m18.segments.find(x => x.id === '0-0');
    
    // Verify properties exist
    assert.strictEqual(typeof seg.pdMonths, 'number', 'Segment should have pdMonths');
    assert.strictEqual(typeof seg.isPersistentDebt, 'boolean', 'Segment should have isPersistentDebt flag');
});

test('FCA: Detects Stage 1 (18 months)', () => {
    const s = FCAScenarios.existingPD();
    // Start at 17 months. After 1 month of high interest, it should hit 18.
    const results = runSimulation(s, { maxMonths: 5 });
    
    const m1 = results.months[0]; // Month 1 (Cumulative 18)
    const seg = m1.segments[0];
    
    assert.strictEqual(seg.pdMonths, 18, 'Should be flagged as 18 months PD');
    assert.strictEqual(seg.isPersistentDebt, true, 'isPersistentDebt should be true');
});

export const run = () => {};
