
import assert from 'assert';
import fs from 'fs';
import path from 'path';

// --- Test Framework Helpers ---
const filter = process.argv[2];
let testsRun = 0;
let testsPassed = 0;
let testsFailed = 0;
let testsSkipped = 0;

function test(name, fn) {
    if (filter && !name.toLowerCase().includes(filter.toLowerCase())) {
        testsSkipped++;
        return;
    }
    testsRun++;
    try {
        fn();
        console.log(`✅ PASS: ${name}`);
        testsPassed++;
    } catch (e) {
        console.error(`❌ FAIL: ${name}`);
        console.error('  ' + e.message);
        console.error('  ' + e.stack?.split('\n')[1]?.trim().replace("at file:///", '').replace(process.cwd().replace(/\\/g, '/'), '.'));
        testsFailed++;
    }
}

function summarize() {
    console.log(`\n--- Test Summary ---`);
    if (filter) console.log(`Filter: "${filter}"`);
    console.log(`Run:    ${testsRun}`);
    console.log(`Passed: ${testsPassed}`);
    console.log(`Failed: ${testsFailed}`);
    console.log(`Skipped:${testsSkipped}`);
    if (testsFailed > 0) process.exit(1);
}

function getTestFiles() {
    function searchDir(dir, fileList = []) {
        const files = fs.readdirSync(dir);
        files.forEach(file => {
            const filePath = path.join(dir, file);
            const stat = fs.statSync(filePath);
            if (stat.isDirectory()) {
                if (file !== 'node_modules') {
                    searchDir(filePath, fileList);
                }
            } else {
                if (file.endsWith('.test.js')) {
                    fileList.push(filePath);
                }
            }
        });
        return fileList;
    }

    return searchDir(process.cwd());
}

function filterAndRunTests() {
    return new Promise((resolve) => {
    const testFiles = getTestFiles();
    let testFilesCount = testFiles.length;
    testFiles.forEach(file => {
        //if (!filter || file.toLowerCase().includes(filter.toLowerCase())) {
            import(`file://${file}`)
                .then(module => {
                    // Check if the module exports a 'run' function and call it
                    if (module.run) {
                        module.run();
                    }
                })
                .catch(err => {
                    console.error(`Failed to load test file: ${file}`, err);
                    testsFailed++;
                })
                .finally(() => {
                    testFilesCount--;
                    if (testFilesCount === 0) {
                        resolve();
                    }
                });
        //} else {
        //    testFilesCount--;
        //}
    });
    if (testFilesCount === 0) {
        resolve();
    }
});


}

const is = {
    approxEqual: (a, b, msg) => assert(Math.abs(a - b) <= tol, stringFormat(msg || `Expected {0} to be approximately equal to {1}`, [a, b])),
    greaterThan: (a, b, msg) => assert(a > b, stringFormat(msg || `Expected {0} to be greater than {1}`, [a, b])),
    lessThan: (a, b, msg) => assert(a < b, stringFormat(msg || `Expected {0} to be less than {1}`, [a, b])),
}

function stringFormat(string, args) {
    return string.replace(/{(\d+)}/g, (match, number) => 
        typeof args[number] !== 'undefined' ? args[number] : match
    );
}

export { test, summarize, filterAndRunTests, is };
// --- Test Objects / Factories ---


