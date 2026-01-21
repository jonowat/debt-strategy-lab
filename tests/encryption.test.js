
import assert from 'assert';
import { test } from "./test_framework.js";
import { encryptData, decryptData } from "../js/state.js";

// Mock minimal browser globals for Node environment
if (typeof window === 'undefined') {
    global.window = {
        crypto: globalThis.crypto,
        location: { hash: '' },
        history: { replaceState: () => {} }
    };
    global.sessionStorage = {
        getItem: () => null,
        setItem: () => {},
        removeItem: () => {}
    };
    global.document = {
        getElementById: () => null,
        querySelectorAll: () => []
    };
}

export async function run() {
    await test("Encryption: Successful Encrypt and Decrypt Cycle", async () => {
        const password = "test-password-123";
        const secretPayload = JSON.stringify({
            debts: [{ name: "Amex", balance: 5000 }],
            strategy: "avalanche"
        });

        const encrypted = await encryptData(secretPayload, password);
        
        assert(typeof encrypted === 'string', "Encrypted output should be a string");
        assert(encrypted.startsWith('enc:'), "Encrypted string should have 'enc:' prefix");
        assert(encrypted !== secretPayload, "Encrypted string should not match plain text");

        const decrypted = await decryptData(encrypted, password);
        assert.strictEqual(decrypted, secretPayload, "Decrypted data should match original payload");
    });

    await test("Encryption: Fails with incorrect password", async () => {
        const password = "correct-password";
        const secretPayload = "This is a secret";

        const encrypted = await encryptData(secretPayload, password);
        
        // Try to decrypt with wrong password
        // Note: DecryptData logs a console error and returns null on failure
        const decrypted = await decryptData(encrypted, "wrong-password");
        
        assert.strictEqual(decrypted, null, "Decryption with wrong password should return null");
    });

    await test("Encryption: Handles empty or null inputs gracefully", async () => {
        const payload = "";
        const password = "p";
        
        const encrypted = await encryptData(payload, password);
        const decrypted = await decryptData(encrypted, password);
        
        assert.strictEqual(decrypted, "", "Should handle empty string encryption");
    });
}
