const nodemailer = require('nodemailer');
const { db } = require('../db/database');

class EmailService {
  constructor() {
    this.transporter = null;
    this.initTransporter();
  }

  initTransporter() {
    const user = process.env.SMTP_USER || process.env.GMAIL_USER;
    const pass = process.env.SMTP_PASS || process.env.GMAIL_APP_PASS;

    if (user && pass) {
      this.transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
          user: user,
          pass: pass
        }
      });
      console.log(`📧 Gmail SMTP Service configured with: ${user}`);
    } else {
      console.log('⚠️ Gmail SMTP credentials not found in env (SMTP_USER / SMTP_PASS). Emails will log to console in development mode.');
    }
  }

  generateOtp() {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  async sendEmail({ to, subject, html, text }) {
    if (!this.transporter) {
      this.initTransporter();
    }

    const fromAddress = process.env.SMTP_USER || process.env.GMAIL_USER || '"Catalyst Capital" <noreply@catalystcapital.fit>';

    if (this.transporter) {
      try {
        const info = await this.transporter.sendMail({
          from: fromAddress,
          to,
          subject,
          text: text || html.replace(/<[^>]+>/g, ''),
          html
        });
        console.log(`[Email Sent] To: ${to} | Subject: ${subject} | MessageId: ${info.messageId}`);
        return { success: true, messageId: info.messageId };
      } catch (err) {
        console.error(`[Email Error] Failed to send to ${to}:`, err.message);
        // Fallback log
        console.log(`[Dev Fallback Mail] To: ${to}\nSubject: ${subject}\nBody: ${text || html}`);
        return { success: false, error: err.message, devLogged: true };
      }
    } else {
      console.log(`========================================`);
      console.log(`[DEV EMAIL SIMULATION]`);
      console.log(`TO: ${to}`);
      console.log(`SUBJECT: ${subject}`);
      console.log(`CONTENT:\n${text || html}`);
      console.log(`========================================`);
      return { success: true, simulated: true };
    }
  }

  async createAndSendOtp(email, purpose = 'registration') {
    const cleanEmail = email.trim().toLowerCase();
    const otp = this.generateOtp();

    // Expiry: 10 minutes from now
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    // Invalidate old OTPs for this email and purpose
    await db.run('DELETE FROM email_otps WHERE email = ? AND purpose = ?', [cleanEmail, purpose]);

    // Save OTP
    await db.run(`
      INSERT INTO email_otps (email, otp, purpose, expires_at)
      VALUES (?, ?, ?, ?)
    `, [cleanEmail, otp, purpose, expiresAt]);

    const purposeTitles = {
      registration: 'Registration Verification Code',
      forgot_password: 'Password Reset OTP Code',
      wallet_update: 'USDT (BEP-20) Wallet Address Change OTP',
      email_change: 'Email Address Change Security OTP'
    };

    const title = purposeTitles[purpose] || 'Verification Code';

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 520px; margin: 0 auto; padding: 24px; border: 1px solid #1e293b; border-radius: 16px; background-color: #0b0f19; color: #f8fafc;">
        <div style="text-align: center; margin-bottom: 20px;">
          <h2 style="color: #f59e0b; margin: 0; font-size: 22px; font-weight: 800; letter-spacing: 1px;">CATALYST CAPITAL</h2>
          <p style="color: #94a3b8; font-size: 12px; margin-top: 4px;">Security Verification Service</p>
        </div>
        <div style="background-color: #111827; border: 1px solid #1f2937; border-radius: 12px; padding: 20px; text-align: center;">
          <p style="font-size: 14px; color: #cbd5e1; margin-bottom: 12px;">Your One-Time Password (OTP) for <strong>${title}</strong> is:</p>
          <div style="display: inline-block; padding: 12px 28px; background: linear-gradient(135deg, #f59e0b, #d97706); color: #000; font-size: 28px; font-weight: 900; letter-spacing: 6px; border-radius: 10px; margin: 10px 0;">
            ${otp}
          </div>
          <p style="font-size: 12px; color: #94a3b8; margin-top: 14px;">This OTP is valid for <strong>10 minutes</strong>. Do not share this code with anyone.</p>
        </div>
        <div style="margin-top: 24px; text-align: center; font-size: 11px; color: #64748b;">
          &copy; ${new Date().getFullYear()} Catalyst Capital. High Frequency AI Trading & Wealth Management.
        </div>
      </div>
    `;

    const sendResult = await this.sendEmail({
      to: cleanEmail,
      subject: `[Catalyst Capital] ${otp} is your ${title}`,
      html
    });

    const isSimulated = !this.transporter || sendResult.simulated || sendResult.devLogged;

    return { 
      success: true, 
      message: isSimulated ? `OTP sent! (Dev Mode: ${otp})` : 'OTP sent to your email successfully',
      debugOtp: isSimulated ? otp : undefined
    };
  }

  async verifyOtp(email, otp, purpose) {
    const cleanEmail = email.trim().toLowerCase();
    const cleanOtp = String(otp || '').trim();

    // Allow master bypass ONLY strictly in local automated testing mode
    if (process.env.NODE_ENV === 'test' && (cleanOtp === '123456' || cleanOtp === '999999' || cleanOtp === '000000')) {
      return { success: true };
    }

    const record = await db.get(`
      SELECT * FROM email_otps
      WHERE email = ? AND purpose = ? AND otp = ?
      ORDER BY id DESC LIMIT 1
    `, [cleanEmail, purpose, cleanOtp]);

    if (!record) {
      return { success: false, error: 'Invalid or incorrect OTP code' };
    }

    const now = new Date();
    const expiry = new Date(record.expires_at);
    if (now > expiry) {
      return { success: false, error: 'OTP has expired. Please request a new one.' };
    }

    // Delete verified OTP
    await db.run('DELETE FROM email_otps WHERE id = ?', [record.id]);
    return { success: true };
  }

  async sendWelcomeCredentials({ to, fullName, username, userId, password, referralCode }) {
    const cleanEmail = to.trim().toLowerCase();
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 540px; margin: 0 auto; padding: 24px; border: 1px solid #1e293b; border-radius: 16px; background-color: #0b0f19; color: #f8fafc;">
        <div style="text-align: center; margin-bottom: 20px;">
          <h2 style="color: #f59e0b; margin: 0; font-size: 24px; font-weight: 800; letter-spacing: 1px;">CATALYST CAPITAL</h2>
          <p style="color: #10b981; font-size: 13px; font-weight: bold; margin-top: 4px;">🎉 Registration Successful - Welcome to the Network!</p>
        </div>
        <div style="background-color: #111827; border: 1px solid #1f2937; border-radius: 12px; padding: 20px;">
          <p style="font-size: 14px; color: #cbd5e1; margin-bottom: 16px;">Hello <strong>${fullName}</strong>,</p>
          <p style="font-size: 13px; color: #94a3b8; line-height: 1.5;">Your Catalyst Capital account is officially active. Below are your confidential login credentials and member details:</p>
          
          <table style="width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 13px;">
            <tr style="border-bottom: 1px solid #1e293b;">
              <td style="padding: 10px 0; color: #94a3b8;">Member USERID:</td>
              <td style="padding: 10px 0; font-weight: bold; color: #38bdf8; font-family: monospace; font-size: 15px;">${userId}</td>
            </tr>
            <tr style="border-bottom: 1px solid #1e293b;">
              <td style="padding: 10px 0; color: #94a3b8;">Username:</td>
              <td style="padding: 10px 0; font-weight: bold; color: #f8fafc;">@${username}</td>
            </tr>
            <tr style="border-bottom: 1px solid #1e293b;">
              <td style="padding: 10px 0; color: #94a3b8;">Password:</td>
              <td style="padding: 10px 0; font-weight: bold; color: #f59e0b; font-family: monospace;">${password}</td>
            </tr>
            <tr style="border-bottom: 1px solid #1e293b;">
              <td style="padding: 10px 0; color: #94a3b8;">Registered Email:</td>
              <td style="padding: 10px 0; color: #cbd5e1;">${cleanEmail}</td>
            </tr>
            <tr>
              <td style="padding: 10px 0; color: #94a3b8;">Referral Link:</td>
              <td style="padding: 10px 0; color: #34d399; font-size: 11px; word-break: break-all;">https://www.catalystcapital.fit/register?ref=${referralCode}</td>
            </tr>
          </table>

          <div style="text-align: center; margin-top: 20px;">
            <a href="https://www.catalystcapital.fit/login" style="display: inline-block; padding: 12px 28px; background: linear-gradient(135deg, #f59e0b, #d97706); color: #000; font-weight: bold; text-decoration: none; border-radius: 10px; font-size: 13px;">
              Login to Your Dashboard &rarr;
            </a>
          </div>
        </div>
        <div style="margin-top: 20px; text-align: center; font-size: 11px; color: #64748b; line-height: 1.4;">
          Please keep this information confidential. For security reasons, do not share your password with anyone.<br>
          &copy; ${new Date().getFullYear()} Catalyst Capital.
        </div>
      </div>
    `;

    return this.sendEmail({
      to: cleanEmail,
      subject: `[Catalyst Capital] Welcome! Your Member USERID is ${userId}`,
      html
    });
  }
}

module.exports = new EmailService();
