const nodemailer = require('nodemailer');
const SibApiV3Sdk = require('@sendinblue/client');
require('dotenv').config();

/**
 * Email Controller for sending booking notifications via Brevo (Sendinblue)
 */

// Initialize Brevo API client
const apiInstance = new SibApiV3Sdk.TransactionalEmailsApi();
const apiKey = apiInstance.authentications['apiKey'];
apiKey.apiKey = process.env.BREVO_API_KEY;

// Create reusable transporter using Brevo SMTP
const createTransporter = () => {
  // For Brevo SMTP: username MUST be your Brevo account login email
  // Password is the SMTP key
  const smtpUser = (process.env.BREVO_LOGIN_EMAIL || '').trim();
  const smtpPass = (process.env.BREVO_SMTP_KEY || '').trim();
  
  console.log('🔐 SMTP Config:', {
    host: 'smtp-relay.brevo.com',
    port: 587,
    user: smtpUser,
    hasPassword: !!smtpPass,
    passwordLength: smtpPass ? smtpPass.length : 0,
    keyStart: smtpPass ? smtpPass.substring(0, 20) + '...' : 'MISSING'
  });
  
  if (!smtpUser || !smtpPass) {
    console.error('❌ Missing SMTP credentials! Check your .env file');
    throw new Error('SMTP credentials not configured');
  }
  
  return nodemailer.createTransport({
    host: 'smtp-relay.brevo.com',
    port: 587,
    secure: false,
    auth: {
      user: smtpUser, // MUST be your Brevo account login email
      pass: smtpPass
    },
    tls: {
      rejectUnauthorized: false
    }
  });
};

/**
 * Format date for email display
 */
const formatDate = (dateString) => {
  if (!dateString) return 'N/A';
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
};

/**
 * Format currency for email display
 */
const formatCurrency = (amount) => {
  return `AED ${parseFloat(amount).toFixed(2)}`;
};

/**
 * Send booking confirmation email to customer
 */
const sendBookingConfirmation = async (bookingData) => {
  try {
    const transporter = createTransporter();
    
    // Extract booking details
    const {
      customerName,
      phone,
      address,
      date,
      time,
      hours,
      professionals,
      materials,
      totalAmount,
      instructions,
      id
    } = bookingData;

    // Generate invoice number
    const invoiceNumber = `INV-${id.slice(-6).toUpperCase()}`;

    // Create email HTML content
    const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body {
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      line-height: 1.6;
      color: #333;
      max-width: 600px;
      margin: 0 auto;
      padding: 20px;
      background-color: #f4f4f4;
    }
    .container {
      background-color: #ffffff;
      border-radius: 10px;
      padding: 30px;
      box-shadow: 0 2px 10px rgba(0,0,0,0.1);
    }
    .header {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 30px;
      border-radius: 10px 10px 0 0;
      text-align: center;
      margin: -30px -30px 30px -30px;
    }
    .header h1 {
      margin: 0;
      font-size: 28px;
      font-weight: bold;
    }
    .header p {
      margin: 10px 0 0 0;
      font-size: 16px;
      opacity: 0.9;
    }
    .invoice-number {
      background-color: #f8f9fa;
      padding: 15px;
      border-left: 4px solid #667eea;
      margin-bottom: 20px;
      font-size: 18px;
      font-weight: bold;
      color: #667eea;
    }
    .section {
      margin-bottom: 25px;
    }
    .section-title {
      font-size: 18px;
      font-weight: bold;
      color: #667eea;
      margin-bottom: 15px;
      border-bottom: 2px solid #667eea;
      padding-bottom: 5px;
    }
    .detail-row {
      display: flex;
      justify-content: space-between;
      padding: 10px 0;
      border-bottom: 1px solid #e9ecef;
    }
    .detail-label {
      font-weight: 600;
      color: #666;
    }
    .detail-value {
      color: #333;
      text-align: right;
    }
    .total-row {
      background-color: #f8f9fa;
      padding: 15px;
      margin-top: 20px;
      border-radius: 5px;
      display: flex;
      justify-content: space-between;
      font-size: 20px;
      font-weight: bold;
    }
    .total-label {
      color: #667eea;
    }
    .total-value {
      color: #28a745;
    }
    .footer {
      margin-top: 30px;
      padding-top: 20px;
      border-top: 2px solid #e9ecef;
      text-align: center;
      color: #666;
      font-size: 14px;
    }
    .footer-note {
      background-color: #fff3cd;
      border-left: 4px solid #ffc107;
      padding: 15px;
      margin-top: 20px;
      border-radius: 5px;
      font-size: 14px;
      color: #856404;
    }
    .button {
      display: inline-block;
      padding: 12px 30px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      text-decoration: none;
      border-radius: 5px;
      margin-top: 20px;
      font-weight: bold;
    }
    @media only screen and (max-width: 600px) {
      body {
        padding: 10px;
      }
      .container {
        padding: 20px;
      }
      .header {
        margin: -20px -20px 20px -20px;
        padding: 20px;
      }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>✨ Booking Confirmed!</h1>
      <p>Thank you for choosing EasyMaid</p>
    </div>

    <div class="invoice-number">
      Invoice: ${invoiceNumber}
    </div>

    <p style="font-size: 16px; color: #333;">
      Dear <strong>${customerName}</strong>,
    </p>
    <p style="font-size: 16px; color: #333;">
      Your cleaning service booking has been confirmed! Here are your booking details:
    </p>

    <div class="section">
      <div class="section-title">📅 Booking Details</div>
      <div class="detail-row">
        <span class="detail-label">Date:</span>
        <span class="detail-value">${formatDate(date)}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Time:</span>
        <span class="detail-value">${time || 'N/A'}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Duration:</span>
        <span class="detail-value">${hours} hour(s)</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Professionals:</span>
        <span class="detail-value">${professionals}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Cleaning Materials:</span>
        <span class="detail-value">${materials ? 'Included' : 'Not Included'}</span>
      </div>
    </div>

    <div class="section">
      <div class="section-title">📍 Service Location</div>
      <div class="detail-row">
        <span class="detail-label">Address:</span>
        <span class="detail-value">${address || 'N/A'}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Contact:</span>
        <span class="detail-value">${phone || 'N/A'}</span>
      </div>
    </div>

    ${instructions ? `
    <div class="section">
      <div class="section-title">📝 Special Instructions</div>
      <p style="background-color: #f8f9fa; padding: 15px; border-radius: 5px; margin: 0;">
        ${instructions}
      </p>
    </div>
    ` : ''}

    <div class="total-row">
      <span class="total-label">Total Amount:</span>
      <span class="total-value">${formatCurrency(totalAmount)}</span>
    </div>

    <div class="footer-note">
      <strong>⚠️ Important:</strong> Our team will arrive at the scheduled time. Please ensure someone is available to provide access to the property. If you need to reschedule or cancel, please contact us at least 24 hours in advance.
    </div>

    <div class="footer">
      <p style="margin: 10px 0;">
        <strong>Need Help?</strong><br>
        Contact us at: <a href="tel:${phone}" style="color: #667eea;">${phone}</a><br>
        Email: <a href="mailto:support@easymaid.com" style="color: #667eea;">support@easymaid.com</a>
      </p>
      <p style="margin-top: 20px; font-size: 12px; color: #999;">
        © ${new Date().getFullYear()} EasyMaid. All rights reserved.<br>
        You're receiving this email because you made a booking with us.
      </p>
    </div>
  </div>
</body>
</html>
    `;

    // Plain text version
    const textContent = `
BOOKING CONFIRMATION - ${invoiceNumber}

Dear ${customerName},

Your cleaning service booking has been confirmed!

BOOKING DETAILS:
- Date: ${formatDate(date)}
- Time: ${time || 'N/A'}
- Duration: ${hours} hour(s)
- Professionals: ${professionals}
- Materials: ${materials ? 'Included' : 'Not Included'}

SERVICE LOCATION:
- Address: ${address || 'N/A'}
- Contact: ${phone || 'N/A'}

${instructions ? `SPECIAL INSTRUCTIONS:\n${instructions}\n` : ''}

TOTAL AMOUNT: ${formatCurrency(totalAmount)}

IMPORTANT: Our team will arrive at the scheduled time. Please ensure someone is available to provide access to the property.

Need Help?
Contact: ${phone}
Email: support@easymaid.com

Thank you for choosing EasyMaid!
    `;

    // Email options
    const mailOptions = {
      from: `"${process.env.SENDER_NAME || 'EasyMaid'}" <${process.env.SENDER_EMAIL || 'noreply@easymaid.com'}>`,
      to: bookingData.email || phone, // Use email if available, fallback to phone
      subject: `Booking Confirmed - ${invoiceNumber} - ${formatDate(date)}`,
      text: textContent,
      html: htmlContent
    };

    // Send email using Brevo API
    const sendSmtpEmail = new SibApiV3Sdk.SendSmtpEmail();
    sendSmtpEmail.sender = { 
      name: process.env.SENDER_NAME || 'EasyMaid',
      email: process.env.SENDER_EMAIL || 'skywardforgetech@gmail.com'
    };
    sendSmtpEmail.to = [{ email: bookingData.email || phone }];
    sendSmtpEmail.subject = `Booking Confirmed - ${invoiceNumber} - ${formatDate(date)}`;
    sendSmtpEmail.htmlContent = htmlContent;
    sendSmtpEmail.textContent = textContent;

    const result = await apiInstance.sendTransacEmail(sendSmtpEmail);
    
    console.log('✅ Booking confirmation email sent via Brevo API:', result.messageId);
    return {
      success: true,
      messageId: result.messageId,
      message: 'Booking confirmation email sent successfully'
    };

  } catch (error) {
    console.error('❌ Error sending booking confirmation email:', error);
    return {
      success: false,
      error: error.message
    };
  }
};

/**
 * Send booking cancellation email to customer
 */
const sendBookingCancellation = async (bookingData) => {
  try {
    const transporter = createTransporter();
    
    const {
      customerName,
      phone,
      date,
      time,
      totalAmount,
      id
    } = bookingData;

    const invoiceNumber = `INV-${id.slice(-6).toUpperCase()}`;

    const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body {
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      line-height: 1.6;
      color: #333;
      max-width: 600px;
      margin: 0 auto;
      padding: 20px;
      background-color: #f4f4f4;
    }
    .container {
      background-color: #ffffff;
      border-radius: 10px;
      padding: 30px;
      box-shadow: 0 2px 10px rgba(0,0,0,0.1);
    }
    .header {
      background: linear-gradient(135deg, #dc3545 0%, #c82333 100%);
      color: white;
      padding: 30px;
      border-radius: 10px 10px 0 0;
      text-align: center;
      margin: -30px -30px 30px -30px;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Booking Cancelled</h1>
    </div>
    <p>Dear <strong>${customerName}</strong>,</p>
    <p>Your booking (${invoiceNumber}) for ${formatDate(date)} at ${time} has been cancelled.</p>
    <p>If you have any questions, please contact us.</p>
    <p>Thank you,<br>EasyMaid Team</p>
  </div>
</body>
</html>
    `;

    // Send email using Brevo API
    const sendSmtpEmail = new SibApiV3Sdk.SendSmtpEmail();
    sendSmtpEmail.sender = { 
      name: process.env.SENDER_NAME || 'EasyMaid',
      email: process.env.SENDER_EMAIL || 'skywardforgetech@gmail.com'
    };
    sendSmtpEmail.to = [{ email: bookingData.email || phone }];
    sendSmtpEmail.subject = `Booking Cancelled - ${invoiceNumber}`;
    sendSmtpEmail.htmlContent = htmlContent;

    const result = await apiInstance.sendTransacEmail(sendSmtpEmail);
    
    console.log('✅ Cancellation email sent via Brevo API:', result.messageId);
    return {
      success: true,
      messageId: result.messageId
    };

  } catch (error) {
    console.error('❌ Error sending cancellation email:', error);
    return {
      success: false,
      error: error.message
    };
  }
};

/**
 * Send payment confirmation email
 */
const sendPaymentConfirmation = async (bookingData, paymentAmount) => {
  try {
    const transporter = createTransporter();
    
    const {
      customerName,
      phone,
      date,
      id,
      totalAmount,
      dueBalance
    } = bookingData;

    const invoiceNumber = `INV-${id.slice(-6).toUpperCase()}`;

    const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body {
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      line-height: 1.6;
      color: #333;
      max-width: 600px;
      margin: 0 auto;
      padding: 20px;
      background-color: #f4f4f4;
    }
    .container {
      background-color: #ffffff;
      border-radius: 10px;
      padding: 30px;
      box-shadow: 0 2px 10px rgba(0,0,0,0.1);
    }
    .header {
      background: linear-gradient(135deg, #28a745 0%, #218838 100%);
      color: white;
      padding: 30px;
      border-radius: 10px 10px 0 0;
      text-align: center;
      margin: -30px -30px 30px -30px;
    }
    .amount-box {
      background-color: #d4edda;
      border-left: 4px solid #28a745;
      padding: 20px;
      margin: 20px 0;
      border-radius: 5px;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>💰 Payment Received</h1>
    </div>
    <p>Dear <strong>${customerName}</strong>,</p>
    <p>We have received your payment for booking ${invoiceNumber}.</p>
    <div class="amount-box">
      <h3 style="margin: 0 0 10px 0;">Payment Details:</h3>
      <p style="margin: 5px 0;"><strong>Amount Paid:</strong> ${formatCurrency(paymentAmount)}</p>
      <p style="margin: 5px 0;"><strong>Booking Total:</strong> ${formatCurrency(totalAmount)}</p>
      ${dueBalance > 0 ? `<p style="margin: 5px 0; color: #dc3545;"><strong>Remaining Balance:</strong> ${formatCurrency(dueBalance)}</p>` : '<p style="margin: 5px 0; color: #28a745;"><strong>Status:</strong> Fully Paid ✓</p>'}
    </div>
    <p>Thank you for your payment!</p>
    <p>Best regards,<br>EasyMaid Team</p>
  </div>
</body>
</html>
    `;

    // Send email using Brevo API
    const sendSmtpEmail = new SibApiV3Sdk.SendSmtpEmail();
    sendSmtpEmail.sender = { 
      name: process.env.SENDER_NAME || 'EasyMaid',
      email: process.env.SENDER_EMAIL || 'skywardforgetech@gmail.com'
    };
    sendSmtpEmail.to = [{ email: bookingData.email || phone }];
    sendSmtpEmail.subject = `Payment Received - ${invoiceNumber}`;
    sendSmtpEmail.htmlContent = htmlContent;

    const result = await apiInstance.sendTransacEmail(sendSmtpEmail);
    
    console.log('✅ Payment confirmation email sent via Brevo API:', result.messageId);
    return {
      success: true,
      messageId: result.messageId
    };

  } catch (error) {
    console.error('❌ Error sending payment confirmation email:', error);
    return {
      success: false,
      error: error.message
    };
  }
};

/**
 * Send coupon email to customer
 */
const sendCouponEmail = async ({
  to,
  customerName,
  code,
  title,
  description,
  discountType,
  discountValue,
  validFrom,
  validUntil
}) => {
  try {
    const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body {
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      line-height: 1.6;
      color: #333;
      max-width: 600px;
      margin: 0 auto;
      padding: 20px;
      background-color: #f4f4f4;
    }
    .container {
      background-color: #ffffff;
      border-radius: 10px;
      padding: 30px;
      box-shadow: 0 2px 10px rgba(0,0,0,0.1);
    }
    .header {
      background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
      color: white;
      padding: 30px;
      border-radius: 10px 10px 0 0;
      text-align: center;
      margin: -30px -30px 30px -30px;
    }
    .coupon-code {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      font-size: 28px;
      font-weight: bold;
      padding: 20px;
      border-radius: 10px;
      text-align: center;
      letter-spacing: 3px;
      margin: 20px 0;
      border: 3px dashed white;
      box-shadow: 0 4px 6px rgba(0,0,0,0.1);
    }
    .discount-box {
      background-color: #fff3cd;
      border-left: 4px solid #ffc107;
      padding: 20px;
      margin: 20px 0;
      border-radius: 5px;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🎁 You've Got a Reward!</h1>
    </div>
    <p>Dear <strong>${customerName}</strong>,</p>
    <p>Congratulations! You've earned a special coupon as a reward for being a valued customer.</p>
    
    <h3 style="color: #667eea; margin-top: 30px;">${title || 'Special Discount'}</h3>
    <p style="color: #666;">${description || 'Use this coupon on your next booking!'}</p>
    
    <div class="coupon-code">
      ${code}
    </div>
    
    <div class="discount-box">
      <h3 style="margin: 0 0 10px 0; color: #856404;">Discount Details:</h3>
      <p style="margin: 5px 0; font-size: 18px; font-weight: bold;">
        ${discountType === 'percentage' ? `${discountValue}% OFF` : `AED ${discountValue} OFF`}
      </p>
      ${validFrom && validUntil ? `<p style="margin: 5px 0; color: #856404;"><strong>Valid:</strong> ${formatDate(validFrom)} - ${formatDate(validUntil)}</p>` : ''}
    </div>
    
    <p style="background-color: #d4edda; border-left: 4px solid #28a745; padding: 15px; border-radius: 5px;">
      <strong>📱 How to Use:</strong><br>
      Simply enter the code <strong>${code}</strong> when making your next booking to apply this discount!
    </p>
    
    <p style="margin-top: 30px;">Thank you for choosing EasyMaid!</p>
    <p>Best regards,<br>EasyMaid Team</p>
  </div>
</body>
</html>
    `;

    const sendSmtpEmail = new SibApiV3Sdk.SendSmtpEmail();
    sendSmtpEmail.sender = { 
      name: process.env.SENDER_NAME || 'EasyMaid',
      email: process.env.SENDER_EMAIL || 'skywardforgetech@gmail.com'
    };
    sendSmtpEmail.to = [{ email: to }];
    sendSmtpEmail.subject = `🎁 Congratulations! You've earned a reward - ${title || 'Special Coupon'}`;
    sendSmtpEmail.htmlContent = htmlContent;

    const result = await apiInstance.sendTransacEmail(sendSmtpEmail);
    
    console.log('✅ Coupon email sent via Brevo API:', result.messageId);
    return {
      success: true,
      messageId: result.messageId
    };

  } catch (error) {
    console.error('❌ Error sending coupon email:', error);
    return {
      success: false,
      error: error.message
    };
  }
};

module.exports = {
  sendBookingConfirmation,
  sendBookingCancellation,
  sendPaymentConfirmation,
  sendCouponEmail
};
