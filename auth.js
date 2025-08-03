// auth.js
import fs from "fs-extra";
import path from "path";
import { google } from "googleapis";
import open from "open";

const SCOPES = ['https://www.googleapis.com/auth/drive.file'];
const TOKEN_PATH = path.join('.', 'token.json');
const CREDENTIALS_PATH = path.join('.', 'client_secret.json');

export async function authorize() {
    const content = await fs.readFile(CREDENTIALS_PATH, 'utf-8');
    const credentials = JSON.parse(content);
    const { client_secret, client_id, redirect_uris } = credentials.web;
    console.log("Using credentials:", client_id);

    const oAuth2Client = new google.auth.OAuth2(
        client_id, client_secret, redirect_uris[0]);

    console.log("Creating OAuth2 client...", oAuth2Client);
    
    console.log("Checking for existing token...");
    
    if (fs.existsSync(TOKEN_PATH)) {
        const token = await fs.readJSON(TOKEN_PATH);
        oAuth2Client.setCredentials(token);
        return oAuth2Client;
    }

    const authUrl = oAuth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: SCOPES,
    });

    console.log("Authorize this app by visiting this URL:", authUrl);
    await open(authUrl);
    const readline = await import("readline");
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    const code = await new Promise(resolve => {
        rl.question("Enter the code from that page here: ", resolve);
    });

    rl.close();

    const tokenResponse = await oAuth2Client.getToken(code);
    oAuth2Client.setCredentials(tokenResponse.tokens);

    await fs.writeJSON(TOKEN_PATH, tokenResponse.tokens);
    console.log("✅ Token stored to", TOKEN_PATH);

    return oAuth2Client;
}
