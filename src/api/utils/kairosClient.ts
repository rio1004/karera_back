import axios from "axios";

const KAIROS_API_BASE = "https://idv-eu.kairos.com/v0.1";
const APP_ID = "53371ee9"!;
const APP_KEY = "8471781d737ec0492b88bc3eb2169360"!;

export async function callKairos(endpoint: string, payload: any, isFileUpload = false) {
  let headers: Record<string, string> = { app_id: APP_ID, app_key: APP_KEY };

  if (isFileUpload) {
    headers = { ...headers, ...payload.getHeaders() };
    const res = await axios.post(`${KAIROS_API_BASE}/${endpoint}`, payload, { headers });
    return res.data;
  } else {
    const res = await axios.post(`${KAIROS_API_BASE}/${endpoint}`, payload, {
      headers: { ...headers, "Content-Type": "application/json" },
    });
    return res.data;
  }
}
