// =============================================================================
// Portal runtime configuration.
// FILL THESE IN after `sam deploy` prints the stack Outputs, then load this
// file BEFORE cognito-auth.js and portal-api-client.js on every portal page.
//
//   <script src="portal-config.js"></script>
//   <script src="portal-api-client.js"></script>
//   <script src="cognito-auth.js"></script>
//
// Map of SAM Output -> value to paste below:
//   UserPoolId       -> COGNITO_USER_POOL_ID
//   UserPoolClientId -> COGNITO_CLIENT_ID
//   ApiUrl           -> PORTAL_API_BASE
//   Region           -> COGNITO_REGION
// =============================================================================
window.PORTAL_CONFIG = {
  COGNITO_USER_POOL_ID: 'us-east-1_dqqgSRKwn',
  COGNITO_CLIENT_ID:    '1ceidj2abdvs0jijedhckte5um',
  COGNITO_REGION:       'us-east-1',
};
// Convenience alias used by portal-api-client.js.
window.PORTAL_API_BASE = 'https://2hp2bdxsz6.execute-api.us-east-1.amazonaws.com';
