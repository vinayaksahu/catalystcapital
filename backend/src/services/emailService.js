const nodemailer = require('nodemailer');
const { db } = require('../db/database');

class EmailService {
  constructor() {
    this.transporter = null;
    this.initTransporter();
  }

  async initTransporter() {
    let user = process.env.SMTP_USER || process.env.GMAIL_USER;
    let pass = process.env.SMTP_PASS || process.env.GMAIL_APP_PASS;
    let host = process.env.SMTP_HOST;
    let port = process.env.SMTP_PORT ? parseInt(process.env.SMTP_PORT, 10) : undefined;
    let secure = process.env.SMTP_SECURE === 'true' || port === 465;
    let from = process.env.SMTP_FROM;

    // Check system_settings in database to allow configuration directly from platform settings
    try {
      const rows = await db.all("SELECT key, value FROM system_settings WHERE key LIKE 'smtp_%'");
      if (rows && rows.length > 0) {
        const s = {};
        rows.forEach(r => s[r.key] = r.value);
        if (s['smtp_user']) user = s['smtp_user'];
        if (s['smtp_pass']) pass = s['smtp_pass'];
        if (s['smtp_host']) host = s['smtp_host'];
        if (s['smtp_port']) port = parseInt(s['smtp_port'], 10);
        if (s['smtp_secure'] !== undefined) secure = s['smtp_secure'] === '1' || s['smtp_secure'] === 'true';
        if (s['smtp_from']) from = s['smtp_from'];
      }
    } catch (e) {
      // ignore
    }

    if (user && pass) {
      user = String(user).trim().toLowerCase();
      // Automatically strip all spaces from password (e.g. Google App Passwords copied with 4-letter groups)
      pass = String(pass).replace(/\s+/g, '').trim();
      if (host && host.trim()) {
        host = String(host).trim();
        this.transporter = nodemailer.createTransport({
          host,
          port: port || 587,
          secure: secure !== undefined ? secure : (port === 465),
          auth: { user, pass },
          tls: { rejectUnauthorized: false }
        });
        console.log(`📧 Custom SMTP Service configured with: ${host}:${port || 587} (${user})`);
      } else {
        this.transporter = nodemailer.createTransport({
          service: 'gmail',
          auth: { user, pass }
        });
        console.log(`📧 Gmail SMTP Service configured with: ${user}`);
      }
      this.fromAddress = from || user;
    } else {
      this.transporter = null;
      console.log('⚠️ SMTP credentials not found in env or database settings.');
    }
    return this.transporter;
  }

  generateOtp() {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  async sendEmail({ to, subject, html, text }) {
    if (!this.transporter) {
      await this.initTransporter();
    }

    if (!this.transporter) {
      console.error(`[Email Error] SMTP is not configured. Cannot send email to ${to}.`);
      return { 
        success: false, 
        error: 'SMTP email delivery service is not configured. Please configure SMTP credentials in Platform Settings or environment variables.' 
      };
    }

    const cleanTo = String(to).trim().toLowerCase();
    const fromAddress = this.fromAddress || process.env.SMTP_FROM || process.env.SMTP_USER || process.env.GMAIL_USER || '"Catalyst Capital" <noreply@catalystcapital.fit>';

    try {
      const info = await this.transporter.sendMail({
        from: fromAddress,
        to: cleanTo,
        subject,
        text: text || html.replace(/<[^>]+>/g, ''),
        html
      });
      console.log(`[Email Sent] To: ${cleanTo} | Subject: ${subject} | MessageId: ${info.messageId}`);
      return { success: true, messageId: info.messageId };
    } catch (err) {
      console.error(`[Email Error] Failed to send to ${cleanTo}:`, err.message);
      return { success: false, error: `Email delivery failed: ${err.message}` };
    }
  }

  async createAndSendOtp(email, purpose = 'registration') {
    const cleanEmail = email.trim().toLowerCase();
    const otp = this.generateOtp();

    // Expiry: 10 minutes from now
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

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

    if (!sendResult.success) {
      return {
        success: false,
        error: sendResult.error || 'Failed to send OTP to your email. Please verify SMTP email settings.'
      };
    }

    // Only record OTP once email was successfully dispatched
    await db.run('DELETE FROM email_otps WHERE email = ? AND purpose = ?', [cleanEmail, purpose]);
    await db.run(`
      INSERT INTO email_otps (email, otp, purpose, expires_at)
      VALUES (?, ?, ?, ?)
    `, [cleanEmail, otp, purpose, expiresAt]);

    return { 
      success: true, 
      message: `Security OTP sent to your registered email (${cleanEmail}). Please check inbox and spam.`
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
