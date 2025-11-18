const express = require('express');
const cors = require('cors');
const { authenticateToken } = require('./middleware/auth');
require('dotenv').config(); // Load environment variables
const app = express();

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Public routes (no authentication required)
app.get('/', (req, res) => {
  res.send('HomeClean Backend API');
});

// Protected routes (authentication required)
// Note: /bookings/stream handles its own authentication via query parameter
app.use('/bookings', require('./routes/bookings'));
app.use('/crews', authenticateToken, require('./routes/crews'));
app.use('/drivers', authenticateToken, require('./routes/drivers'));
app.use('/users', authenticateToken, require('./routes/users'));
app.use('/pricing', authenticateToken, require('./routes/pricing'));
app.use('/zones', authenticateToken, require('./routes/zones'));
app.use('/coupons', authenticateToken, require('./routes/coupons'));
app.use('/request_subscriptions', authenticateToken, require('./routes/requestSubscriptions'));
app.use('/notifications', authenticateToken, require('./routes/notifications'));
app.use('/realtime', authenticateToken, require('./routes/realtime'));
app.use('/settings', authenticateToken, require('./routes/settings'));

// Admin routes - /admin/login is public, others are protected
app.use('/admin', require('./routes/admin'));

const PORT = process.env.PORT || 4000;
const server = app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// Start scheduled tasks
const scheduledTasks = require('./scheduledTasks');
scheduledTasks.start().catch(err => {
  console.error('Error starting scheduled tasks:', err);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('Shutting down server...');
  scheduledTasks.stop();
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

process.on('SIGTERM', () => {
  console.log('Shutting down server...');
  scheduledTasks.stop();
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
}); 