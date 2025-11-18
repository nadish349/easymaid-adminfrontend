# Booking Synchronization Deployment Guide

This guide explains how to deploy and use the booking synchronization system that maintains data consistency between the main `bookings` collection and user subcollections.

## Architecture Overview

```
bookings/{bookingId}                    ← Main collection
users/{userId}/bookings/{bookingId}     ← Mirrored subcollection
```

### Data Flow:
1. **Admin creates booking** → Saved to `bookings/{bookingId}`
2. **Trigger fires** → Creates copy in `users/{userId}/bookings/{bookingId}`
3. **Status updates** → Synced automatically via triggers
4. **Booking deletion** → Both copies deleted

## Deployment Steps

### 1. Update Firestore Rules

Add these rules to your `firestore.rules`:

```javascript
// Users collection - allow access to user subcollections
match /users/{userId} {
  allow read, write: if request.auth != null && request.auth.uid == userId;
  
  // Allow service accounts to access user subcollections for booking sync
  allow read, write: if request.auth != null && 
    request.auth.token.firebase.sign_in_provider == 'service_account';
  
  // User bookings subcollection
  match /bookings/{bookingId} {
    allow read, write: if request.auth != null && request.auth.uid == userId;
    allow read, write: if request.auth != null && 
      request.auth.token.firebase.sign_in_provider == 'service_account';
  }
  
  // User notifications subcollection
  match /notifications/{notificationId} {
    allow read, write: if request.auth != null && request.auth.uid == userId;
  }
}
```

### 2. Deploy Firebase Functions

```bash
# Navigate to functions directory
cd backend/functions

# Install dependencies
npm install

# Deploy functions
firebase deploy --only functions
```

### 3. Test the System

```bash
# Run the test suite
cd backend
node tests/bookingSync.test.js
```

## API Endpoints

### Booking Management

#### Create Booking
```http
POST /bookings
Content-Type: application/json
Authorization: Bearer <token>

{
  "userId": "user123",
  "customerId": "user123",
  "date": "2025-01-15",
  "time": "10:00 - 12:00",
  "hours": 2,
  "professionals": 2,
  "materials": true,
  "instructions": "Special instructions",
  "assignedStatus": "unassigned",
  "totalAmount": 150.00
}
```

#### Update Booking Status
```http
PUT /bookings/{bookingId}
Content-Type: application/json
Authorization: Bearer <token>

{
  "assignedStatus": "assigned"
}
```

#### Validate Synchronization
```http
GET /bookings/{bookingId}/validate?userId={userId}
Authorization: Bearer <token>
```

#### Repair Missing Mirror
```http
POST /bookings/{bookingId}/repair
Content-Type: application/json
Authorization: Bearer <token>

{
  "userId": "user123"
}
```

## Monitoring & Maintenance

### 1. Check Function Logs
```bash
firebase functions:log --only onBookingCreated,onBookingUpdated,onBookingDeleted
```

### 2. Validate Data Consistency
```javascript
// Use the validation endpoint to check specific bookings
const response = await fetch('/bookings/bookingId/validate?userId=user123');
const validation = await response.json();
console.log(validation);
```

### 3. Repair Missing Mirrors
If you find missing mirrored bookings, use the repair endpoint:
```javascript
const response = await fetch('/bookings/bookingId/repair', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ userId: 'user123' })
});
```

## Error Handling

The system includes comprehensive error handling:

- **Non-blocking**: Mirror failures don't prevent main booking creation
- **Logging**: All operations are logged with success/failure status
- **Recovery**: Repair endpoints allow fixing missing mirrors
- **Validation**: Check endpoints verify data consistency

## Performance Considerations

- **Batch Operations**: Use Firestore batch writes for multiple operations
- **Indexing**: Ensure proper indexes for querying user bookings
- **Monitoring**: Watch function execution times and error rates

## Troubleshooting

### Common Issues:

1. **Missing Mirrored Bookings**
   - Use repair endpoint to recreate
   - Check function logs for errors

2. **Status Sync Failures**
   - Verify user subcollection exists
   - Check Firestore rules permissions

3. **Function Timeouts**
   - Monitor function execution time
   - Consider increasing timeout limits

### Debug Commands:

```bash
# Check function status
firebase functions:list

# View recent logs
firebase functions:log --limit 50

# Test locally
firebase emulators:start --only functions,firestore
```

## Security Notes

- Service account has full access to user subcollections for sync operations
- Users can only access their own booking subcollections
- All operations require proper authentication
- Sensitive data is logged with appropriate masking

## Support

For issues or questions:
1. Check function logs first
2. Run validation tests
3. Use repair endpoints for data recovery
4. Review Firestore rules for permission issues

