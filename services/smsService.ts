import axios from 'axios';

export async function sendSms({ recipient, message }: { recipient: string; message: string }) {
    // SAMPLE USAGE: sendSms({recipient: "09348039484", message: `Your Message ${message}.`})
    const baseUrl = process.env.SMS_BASE_URL || '';
    const shortcodeMask = process.env.SMS_SHORTCODE_MASK || '';
    const appKey = process.env.SMS_APP_KEY || '';
    const appSecret = process.env.SMS_APP_SECRET || '';
    const smsEnabled = process.env.SMS_ENABLED === "true";

    if (!recipient || !message) {
        throw new Error('recipient and message are required.');
    }

    // ✅ Control via SMS_ENABLED, regardless of APP_ENV
    if (!smsEnabled) {
        console.log(`SIMULATING SMS (disabled): To ${recipient} -> ${message}`);
        return { success: true, simulated: true };
    }

    if (!baseUrl || !shortcodeMask || !appKey || !appSecret) {
        throw new Error('SMS credentials are not properly set in environment variables.');
    }
    if (!baseUrl.startsWith('http')) {
        throw new Error('SMS_BASE_URL is invalid or empty.');
    }

    const smsPayload = {
        app_key: appKey,
        app_secret: appSecret,
        msisdn: recipient,
        content: message,
        shortcode_mask: shortcodeMask,
        is_intl: false,
    };

    try {
        const smsRes = await axios.post(`${baseUrl}broadcast`, smsPayload, {
            headers: { 'Content-Type': 'application/json' },
        });
        return smsRes.data;
    } catch (err: any) {
        throw err?.response?.data?.error || err;
    }
}
