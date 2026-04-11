/**
 * @file notify.ts
 * @package apps/api
 *
 * Email notification service for governance events.
 *
 * Uses Resend (https://resend.com) — free tier: 100 emails/day, 3,000/month.
 * If RESEND_API_KEY is not set, all notifications are silently skipped.
 * This means the app works fully without email config — just no notifications.
 *
 * Events that trigger notifications:
 *   1. APPROVAL_NEEDED  — admin receives email when an agent request needs human review
 *   2. APPROVAL_DECISION — agent owner receives outcome (approved/rejected) after admin acts
 *
 * Email design: minimal HTML, works in dark and light mode clients.
 * All amounts in USDC. Links back to the dashboard for one-click action.
 */

import { Resend } from 'resend';

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

const FROM = process.env.NOTIFICATION_FROM_EMAIL ?? 'CommandRail <noreply@commandrail.io>';
const DASHBOARD_URL = process.env.DASHBOARD_URL ?? 'http://localhost:3000';

/**
 * Notify admin(s) that a spend request requires human approval.
 * Called from spend-requests.ts after an ApprovalRequest is created.
 */
export async function notifyApprovalNeeded({
  toEmails,
  agentName,
  vendor,
  amount,
  actionType,
  requestId,
}: {
  toEmails: string[];
  agentName: string;
  vendor: string;
  amount: number;
  actionType: string;
  requestId: string;
}): Promise<void> {
  if (!resend || toEmails.length === 0) return;

  const approvalUrl = `${DASHBOARD_URL}/dashboard/approvals`;

  try {
    await resend.emails.send({
      from: FROM,
      to: toEmails,
      subject: `Action required: ${agentName} wants to spend $${amount} USDC`,
      html: `
        <div style="font-family: -apple-system, sans-serif; max-width: 520px; margin: 0 auto; padding: 24px;">
          <div style="background: #7c3aed; color: white; padding: 16px 20px; border-radius: 8px 8px 0 0;">
            <strong>⚡ CommandRail</strong> — Approval Required
          </div>
          <div style="background: #f9fafb; border: 1px solid #e5e7eb; border-top: none; padding: 24px; border-radius: 0 0 8px 8px;">
            <p style="margin: 0 0 16px; color: #111827; font-size: 16px;">
              <strong>${agentName}</strong> is requesting a spend that exceeds the auto-approval threshold.
            </p>
            <table style="width: 100%; border-collapse: collapse; font-size: 14px; color: #374151;">
              <tr>
                <td style="padding: 6px 0; color: #6b7280;">Vendor</td>
                <td style="padding: 6px 0; font-weight: 600;">${vendor}</td>
              </tr>
              <tr>
                <td style="padding: 6px 0; color: #6b7280;">Amount</td>
                <td style="padding: 6px 0; font-weight: 600; color: #7c3aed;">$${amount} USDC</td>
              </tr>
              <tr>
                <td style="padding: 6px 0; color: #6b7280;">Action Type</td>
                <td style="padding: 6px 0; font-family: monospace;">${actionType}</td>
              </tr>
              <tr>
                <td style="padding: 6px 0; color: #6b7280;">Request ID</td>
                <td style="padding: 6px 0; font-family: monospace; font-size: 12px;">${requestId}</td>
              </tr>
            </table>
            <a href="${approvalUrl}" style="display: inline-block; margin-top: 20px; background: #7c3aed; color: white; text-decoration: none; padding: 10px 20px; border-radius: 6px; font-size: 14px; font-weight: 600;">
              Review in Dashboard →
            </a>
          </div>
        </div>
      `,
    });
  } catch (err) {
    // Never throw — notification failure must not break the governance flow
    console.warn('[notify] Failed to send approval needed email:', err);
  }
}

/**
 * Notify the agent owner of the approval decision (approved or rejected).
 * Called from approvals.ts after an admin approves or rejects.
 */
export async function notifyApprovalDecision({
  toEmail,
  agentName,
  vendor,
  amount,
  decision,
  decisionReason,
  requestId,
}: {
  toEmail: string;
  agentName: string;
  vendor: string;
  amount: number;
  decision: 'approved' | 'rejected';
  decisionReason?: string | null;
  requestId: string;
}): Promise<void> {
  if (!resend || !toEmail) return;

  const isApproved = decision === 'approved';
  const color = isApproved ? '#16a34a' : '#dc2626';
  const emoji = isApproved ? '✅' : '❌';
  const label = isApproved ? 'Approved' : 'Rejected';

  try {
    await resend.emails.send({
      from: FROM,
      to: [toEmail],
      subject: `${emoji} Spend request ${label.toLowerCase()}: ${agentName} → ${vendor} $${amount} USDC`,
      html: `
        <div style="font-family: -apple-system, sans-serif; max-width: 520px; margin: 0 auto; padding: 24px;">
          <div style="background: ${color}; color: white; padding: 16px 20px; border-radius: 8px 8px 0 0;">
            <strong>⚡ CommandRail</strong> — Spend Request ${label}
          </div>
          <div style="background: #f9fafb; border: 1px solid #e5e7eb; border-top: none; padding: 24px; border-radius: 0 0 8px 8px;">
            <p style="margin: 0 0 16px; color: #111827; font-size: 16px;">
              The spend request from <strong>${agentName}</strong> has been <strong style="color: ${color};">${label.toLowerCase()}</strong>.
            </p>
            <table style="width: 100%; border-collapse: collapse; font-size: 14px; color: #374151;">
              <tr>
                <td style="padding: 6px 0; color: #6b7280;">Vendor</td>
                <td style="padding: 6px 0; font-weight: 600;">${vendor}</td>
              </tr>
              <tr>
                <td style="padding: 6px 0; color: #6b7280;">Amount</td>
                <td style="padding: 6px 0; font-weight: 600;">$${amount} USDC</td>
              </tr>
              ${decisionReason ? `
              <tr>
                <td style="padding: 6px 0; color: #6b7280;">Reason</td>
                <td style="padding: 6px 0;">${decisionReason}</td>
              </tr>` : ''}
              <tr>
                <td style="padding: 6px 0; color: #6b7280;">Request ID</td>
                <td style="padding: 6px 0; font-family: monospace; font-size: 12px;">${requestId}</td>
              </tr>
            </table>
          </div>
        </div>
      `,
    });
  } catch (err) {
    console.warn('[notify] Failed to send approval decision email:', err);
  }
}
