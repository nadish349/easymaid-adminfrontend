/**
 * Test script to verify email configuration
 * Run with: node test-email.js
 */

require('dotenv').config();
const { sendBookingConfirmation, sendPaymentConfirmation } = require('./controllers/emailController');

// Test booking data
const testBooking = {
  id: 'test-booking-123',
  customerName: 'Test Customer',
  email: 'skywardforgetech@gmail.com', // Test email (sender email for testing)
  phone: '+1234567890',
  address: '123 Main Street, City, State 12345',
  date: '2024-12-25',
  time: '10:00 - 12:00',
  hours: 2,
  professionals: 1,
  materials: true,
  totalAmount: 150.00,
  instructions: 'Please call before arriving. Gate code is 1234.',
  userId: 'test-user-id'
};

async function testEmailSystem() {
  console.log('🧪 Testing Email System...\n');
  
  // Check environment variables
  console.log('📋 Checking configuration...');
  if (!process.env.BREVO_SMTP_KEY) {
    console.error('❌ BREVO_SMTP_KEY not found in .env file');
    return;
  }
  if (!process.env.SENDER_EMAIL) {
    console.error('❌ SENDER_EMAIL not found in .env file');
    return;
  }
  console.log('✅ Configuration found\n');
  
  console.log(`📧 Sender: ${process.env.SENDER_NAME} <${process.env.SENDER_EMAIL}>`);
  console.log(`📬 Recipient: ${testBooking.email}\n`);
  
  // Test booking confirmation email
  console.log('📤 Sending booking confirmation email...');
  try {
    const result = await sendBookingConfirmation(testBooking);
    if (result.success) {
      console.log('✅ Booking confirmation email sent successfully!');
      console.log(`   Message ID: ${result.messageId}\n`);
    } else {
      console.error('❌ Failed to send booking confirmation email');
      console.error(`   Error: ${result.error}\n`);
    }
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
  
  // Test payment confirmation email
  console.log('📤 Sending payment confirmation email...');
  try {
    const paymentBooking = {
      ...testBooking,
      dueBalance: 50.00
    };
    const result = await sendPaymentConfirmation(paymentBooking, 100.00);
    if (result.success) {
      console.log('✅ Payment confirmation email sent successfully!');
      console.log(`   Message ID: ${result.messageId}\n`);
    } else {
      console.error('❌ Failed to send payment confirmation email');
      console.error(`   Error: ${result.error}\n`);
    }
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
  
  console.log('\n🎉 Email test completed!');
  console.log('\n📝 Next steps:');
  console.log('   1. Check your inbox at', testBooking.email);
  console.log('   2. Verify the email templates look correct');
  console.log('   3. Update SENDER_EMAIL in .env with your verified Brevo email');
  console.log('   4. Test with real bookings');
}

// Run the test
testEmailSystem().catch(console.error);
