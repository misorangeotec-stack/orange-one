// Shared CORS headers. The mobile app (Expo Go) doesn't strictly need these, but
// the web build / browsers send a CORS preflight (OPTIONS) first, so every
// function echoes these back.
export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
