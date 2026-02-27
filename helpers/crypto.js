const crypto = require('crypto').webcrypto;

function strToBuffer(str) {
    return new TextEncoder().encode(str);
}

function bufferToStr(buf) {
    return new TextDecoder().decode(buf);
}

async function importKeyFromBase64(base64Key) {
    const raw = Uint8Array.from(atob(base64Key), c => c.charCodeAt(0));
    return await crypto.subtle.importKey(
        "raw",
        raw,
        { name: "AES-GCM" },
        false,
        ["encrypt", "decrypt"]
    );
}

async function encryptJSON(jsonData, key) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const jsonString = JSON.stringify(jsonData);
    const encoded = strToBuffer(jsonString);

    const ciphertext = await crypto.subtle.encrypt(
        {
            name: "AES-GCM",
            iv: iv,
        },
        key,
        encoded
    );

    return {
        iv: Buffer.from(iv).toString('base64'),
        ciphertext: Buffer.from(ciphertext).toString('base64'),
    };
}

async function decryptJSON(encryptedData, key) {
    const iv = Uint8Array.from(Buffer.from(encryptedData.iv, 'base64'));
    const ciphertext = Uint8Array.from(Buffer.from(encryptedData.ciphertext, 'base64'));

    const decrypted = await crypto.subtle.decrypt(
        {
            name: "AES-GCM",
            iv: iv,
        },
        key,
        ciphertext
    );

    return JSON.parse(bufferToStr(decrypted));
}


async function decryptJSONFromString(encryptedStr, key) {
    const [iv, ciphertext] = encryptedStr.split(':');
    return await decryptJSON({ iv, ciphertext }, key);
}

async function encryptJSONToString(jsonData, key) {
    const { iv, ciphertext } = await encryptJSON(jsonData, key);
    return `${iv}:${ciphertext}`;
}


module.exports = {
    importKeyFromBase64,
    encryptJSON,
    decryptJSON,
    decryptJSONFromString,
    encryptJSONToString,
};