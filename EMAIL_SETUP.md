# Email Notification Setup Guide

This guide explains how to configure and use the Brevo (formerly Sendinblue) email notification system for booking confirmations.

## Configuration

### 1. Environment Variables

The email system requires the following environment variables in your `.env` file:

```env
# Brevo API Configuration
BREVO_API_KEY=your_brevo_api_key_here
BREVO_SMTP_KEY=your_brevo_smtp_key_here

# Sender Information
SENDER_EMAIL=noreply@easymaid.com
SENDER_NAME=EasyMaid Booking Service
```

**Important:** Make sure to replace the sender email with a verified email address in your Brevo account.

### 2. Brevo Account Setup

1. **Sign up for Brevo** at [https://www.brevo.com](https://www.brevo.com)
2. **Verify your sender email** in Brevo dashboard
3. **Get your API keys** from Settings > SMTP & API
   - API Key (starts with `xkeysib-`)
   - SMTP Key (starts with `xsmtpsib-`)

### 3. Add User Email Field

For emails to work, ensure users have an `email` field in their profile:

```javascript
// In users collection
{
  id: "user123",
  name: "John Doe",
  phone: "+1234567890",
  email: "john@example.com", // Required for email notifications
  address: "123 Main St"
}
```

## Features

### Automated Email Notifications

The system automatically sends emails for:

1. **Booking Confirmation** - Sent when a new booking is created
2. **Payment Confirmation** - Sent when payment is recorded (full or partial)
3. **Booking Cancellation** - Sent when a booking is cancelled

### Email Templates

#### 1. Booking Confirmation Email
- Professional HTML template with booking details
- Includes: Date, time, address, professionals, materials, total amount
- Displays invoice number
- Booking instructions and contact information

#### 2. Payment Confirmation Email
- Payment amount received
- Remaining balance (if partial payment)
- Payment status indicator

#### 3. Cancellation Email
- Cancellation confirmation
- Original booking details
- Contact information for rebooking

## API Integration

### Booking Creation with Email

When creating a booking, the system automatically sends a confirmation email:

```javascript
POST /bookings
{
  "userId": "user123",
  "customerName": "John Doe",
  "email": "john@example.com", // Optional: will fetch from user profile if not provided
  "phone": "+1234567890",
  "address": "123 Main St",
  "date": "2024-12-25",
  "time": "10:00 - 12:00",
  "hours": 2,
  "professionals": 1,
  "materials": true,
  "totalAmount": 150
}
```

### Payment Status Update with Email

When updating payment status, a payment confirmation email is sent:

```javascript
PATCH /bookings/:id/payment-status
{
  "paymentStatus": "paid" // or "partial" with paidAmount
}
```

## Email Controller Functions

### `sendBookingConfirmation(bookingData)`
Sends a booking confirmation email with all booking details.

**Parameters:**
- `bookingData`: Booking object with all details including customer info

**Returns:**
```javascript
{
  success: true,
  messageId: "message-id-from-brevo",
  message: "Booking confirmation email sent successfully"
}
```

### `sendPaymentConfirmation(bookingData, paymentAmount)`
Sends a payment receipt email.

**Parameters:**
- `bookingData`: Booking object
- `paymentAmount`: Amount paid

### `sendBookingCancellation(bookingData)`
Sends a cancellation notification email.

## Troubleshooting

### Email Not Sending

1. **Check SMTP credentials**: Verify your Brevo SMTP key is correct
2. **Verify sender email**: Ensure the sender email is verified in Brevo
3. **Check logs**: Look for error messages in console output
4. **User email missing**: Ensure user profile has valid email address

### Testing Emails

Use a test booking to verify email functionality:

```bash
# Create test booking
curl -X POST http://localhost:4000/bookings \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "test-user",
    "customerName": "Test User",
    "email": "test@example.com",
    "phone": "+1234567890",
    "date": "2024-12-25",
    "time": "10:00",
    "hours": 2,
    "totalAmount": 100
  }'
```

### Email Logs

Check backend console for email status:
- ✅ Success: `📧 Booking confirmation email sent for booking {id}`
- ⚠️ Warning: `⚠️ Failed to send booking confirmation email: {error}`

## Security Notes

1. **Never commit .env file** to version control
2. **Keep API keys secure** - do not share publicly
3. **Use environment-specific keys** for development/production
4. **Rotate keys periodically** for security

## Support

For issues with:
- **Brevo service**: Contact [Brevo Support](https://help.brevo.com)
- **Email integration**: Check backend logs and verify configuration
- **Template customization**: Edit `backend/controllers/emailController.js`
