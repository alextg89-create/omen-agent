/**
 * Email Service - SendGrid Integration
 *
 * Sends operational snapshots via SendGrid
 * This module is OPTIONAL - system works without it
 */

const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY;
const FROM_EMAIL = process.env.SENDGRID_FROM_EMAIL || 'noreply@primeagentvault.com';
const SENDGRID_ENABLED = process.env.SENDGRID_ENABLED !== 'false';

let isConfigured = false;
let sgMail = null;

/**
 * Initialize SendGrid client
 */
async function initializeSendGrid() {
  if (!SENDGRID_ENABLED) {
    console.log('[EmailService] SendGrid disabled via SENDGRID_ENABLED=false');
    return false;
  }

  if (!SENDGRID_API_KEY) {
    console.log('[EmailService] SendGrid not configured - email delivery disabled');
    console.log('[EmailService] Set SENDGRID_API_KEY to enable email delivery');
    return false;
  }

  try {
    // Dynamic import - only load if configured
    const sendgrid = await import('@sendgrid/mail');
    sgMail = sendgrid.default;
    sgMail.setApiKey(SENDGRID_API_KEY);
    isConfigured = true;
    console.log('[EmailService] ✅ SendGrid initialized successfully');
    console.log(`[EmailService] From address: ${FROM_EMAIL}`);
    return true;
  } catch (err) {
    console.error('[EmailService] SendGrid initialization failed:', err.message);
    console.error('[EmailService] Email delivery will be disabled');
    isConfigured = false;
    return false;
  }
}

// Initialize on module load (non-blocking)
initializeSendGrid().catch(err => {
  console.warn('[EmailService] Failed to initialize SendGrid:', err.message);
});

/**
 * Check if email service is configured
 */
export function isEmailConfigured() {
  return isConfigured;
}

/**
 * Send email via SendGrid
 *
 * @param {Object} params
 * @param {string} params.to - Recipient email
 * @param {string} params.subject - Email subject
 * @param {string} params.text - Plain text body
 * @param {string} params.html - HTML body (optional)
 * @returns {Promise<{ok: boolean, messageId?: string, error?: string}>}
 */
export async function sendEmail({ to, subject, text, html }) {
  if (!isConfigured) {
    return {
      ok: false,
      error: 'EMAIL_NOT_CONFIGURED',
      message: 'SendGrid not configured. Set SENDGRID_API_KEY in .env'
    };
  }

  if (!to || !subject || !text) {
    return {
      ok: false,
      error: 'INVALID_PARAMS',
      message: 'Missing required parameters: to, subject, text'
    };
  }

  try {
    const msg = {
      to,
      from: FROM_EMAIL,
      subject,
      text,
      ...(html && { html })
    };

    const response = await sgMail.send(msg);

    console.log('[EmailService] Email sent successfully', {
      to,
      subject,
      messageId: response[0]?.headers?.['x-message-id'],
      statusCode: response[0]?.statusCode
    });

    return {
      ok: true,
      messageId: response[0]?.headers?.['x-message-id'],
      statusCode: response[0]?.statusCode,
      deliveredAt: new Date().toISOString()
    };
  } catch (err) {
    console.error('[EmailService] Failed to send email', {
      to,
      subject,
      error: err.message,
      code: err.code,
      statusCode: err.response?.statusCode,
      body: err.response?.body
    });

    return {
      ok: false,
      error: 'SENDGRID_ERROR',
      message: err.message,
      statusCode: err.response?.statusCode,
      details: err.response?.body?.errors
    };
  }
}

/**
 * Send OMEN snapshot email
 *
 * @param {Object} params
 * @param {string} params.to - Recipient email
 * @param {string} params.subject - Email subject
 * @param {string} params.body - Email body (plain text)
 * @param {Object} params.snapshot - Snapshot data for reference
 * @returns {Promise<{ok: boolean, messageId?: string, error?: string}>}
 */
export async function sendSnapshotEmail({ to, subject, body, snapshot }) {
  if (!isConfigured) {
    return {
      ok: false,
      error: 'EMAIL_NOT_CONFIGURED',
      message: 'SendGrid not configured. Set SENDGRID_API_KEY and SENDGRID_FROM_EMAIL in .env'
    };
  }

  return sendEmail({
    to,
    subject,
    text: body
  });
}

export default {
  isEmailConfigured,
  sendEmail,
  sendSnapshotEmail
};
