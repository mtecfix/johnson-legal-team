# SignalWire Session Notes — 2026-07-27

## What Works ✅
- Outbound API calls work perfectly (inline Twiml AND laml-bin URLs)
- Inbound calls now connect (after verifying caller ID)
- LaML bins (cxml_scripts) serve XML correctly from SignalWire's servers
- Greeting plays on inbound calls
- Dial to +13137375542 rings the phone
- Call recording enabled (record="record-from-answer-dual")
- Whisper/screening created (plays announcement before connecting)

## What Doesn't Work ❌
- **Voicemail after decline/timeout**: The inline XML after `</Dial>` does not execute 
  when the Dial leg ends with no-answer/busy. The caller hears continued ringing or silence.
- **SWML relay-bins**: Account cannot execute SWML JSON scripts on calls at all (silent).
  Only LaML (XML) format works via laml-bins.
- **Action URLs on `<Dial>`**: Secondary URL fetches during an active call don't fire.
  The voicemail action URL never gets fetched after dial failure.
- **AI Agent via SWML**: Can't use SignalWire's AI agent feature because it requires 
  SWML which doesn't execute on this account.

## Root Causes Identified
1. **SWML not functional**: relay-bins return SWML JSON but the platform doesn't process 
   it for calls on this account. Only inline Twiml and laml-bins (XML) work.
2. **Action URL not fetching**: When `<Dial>` ends, the action URL should be fetched 
   to continue the call flow. This doesn't happen — possibly a trial/account restriction.
3. **Verified caller requirement**: Inbound calls only work from numbers added to the 
   verified caller ID list. Platform blocks unverified numbers at carrier level (no log entry).

## Current Configuration
- **MetroTec (313) 855-2030**: laml-bin with greeting + Dial(7s) + inline voicemail (not firing)
- **JLT (833) 659-8378**: laml-bin with greeting + Dial(25s) + action URL voicemail

## Accounts/Credentials
- Space: mr-tech-fixes.signalwire.com
- Project ID: e812b295-f230-4a60-a784-e74b60a4e14c
- AWS Secret: johnsonlegalteam/signalwire-api (us-east-1)
- Numbers: +13138552030 (MetroTec), +18336598378 (JLT)

## Next Steps
- Investigate why post-Dial execution fails (may need SignalWire support ticket)
- Consider alternative: external webhook (AWS Lambda) to handle action URLs
- AI agent needs SWML working OR a different approach entirely
