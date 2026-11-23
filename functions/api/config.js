import { handleOptions, jsonResponse } from './_lib/cors.js';
import { getPlatformSettings } from './_lib/auth.js';

export async function onRequestOptions(context) {
  return handleOptions(context, 'GET, OPTIONS');
}

export async function onRequestGet(context) {
  const { request, env } = context;
  let settings = {
    default_trial_days: 35,
    global_ai_enabled: true,
    default_ai_daily_limit: 25,
    default_ai_pro_daily_limit: 3,
    announcement_banner: ''
  };
  if (env && env.DB) {
    settings = await getPlatformSettings(env.DB);
  }
  return jsonResponse({
    appOrigin: (env && env.APP_ORIGIN) || 'https://tutorpilot.us',
    clerkPublishableKey: (env && env.CLERK_PUBLISHABLE_KEY) || '',
    clerkIssuer: (env && env.CLERK_ISSUER) || 'https://clerk.tutorpilot.us',
    defaultTrialDays: Number(settings.default_trial_days || 35) || 35,
    globalAiEnabled: settings.global_ai_enabled !== false,
    announcementBanner: String(settings.announcement_banner || '')
  }, 200, request, env);
}
