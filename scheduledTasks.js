const { db } = require('./firebaseAdmin');

// Simple scheduled task runner
class ScheduledTasks {
  constructor() {
    this.tasks = new Map();
    this.intervals = new Map();
    this.isAutoArchiveEnabled = false;
  }

  // Start the scheduled task system
  async start() {
    console.log('Starting scheduled tasks...');
    
    // Check initial auto-archive setting
    await this.checkAutoArchiveSetting();
    
    // Set up periodic check for auto-archive setting changes
    this.scheduleTask('check-auto-archive-setting', 5 * 60 * 60 * 1000, this.checkAutoArchiveSetting.bind(this));
    
         // Run initial auto-archive check after 1 hour (instead of 5 minutes for 24-hour task)
     setTimeout(() => {
       this.runAutoArchive();
     }, 60 * 60 * 1000);
  }

  // Check if auto-archive is enabled and manage the task accordingly
  async checkAutoArchiveSetting() {
    try {
      const settingsRef = db.collection('settings').doc('archive');
      const settingsDoc = await settingsRef.get();
      
      let autoArchive = false;
      if (settingsDoc.exists) {
        const settings = settingsDoc.data();
        autoArchive = settings.autoArchive || false;
      }
      
             if (autoArchive && !this.isAutoArchiveEnabled) {
         // Enable auto-archive task - run every 24 hours
         console.log('Auto-archive enabled, starting scheduled task...');
         this.scheduleTask('auto-archive', 24 * 60 * 60 * 1000, this.runAutoArchive.bind(this));
         this.isAutoArchiveEnabled = true;
       } else if (!autoArchive && this.isAutoArchiveEnabled) {
        // Disable auto-archive task
        console.log('Auto-archive disabled, stopping scheduled task...');
        this.stopTask('auto-archive');
        this.isAutoArchiveEnabled = false;
      }
    } catch (error) {
      console.error('Error checking auto-archive setting:', error);
    }
  }

  // Schedule a task to run at specified intervals
  scheduleTask(name, intervalMs, taskFunction) {
    if (this.intervals.has(name)) {
      clearInterval(this.intervals.get(name));
    }
    
    const intervalId = setInterval(async () => {
      try {
        await taskFunction();
      } catch (error) {
        console.error(`Error in scheduled task ${name}:`, error);
      }
    }, intervalMs);
    
         this.intervals.set(name, intervalId);
     const hours = intervalMs / (1000 * 60 * 60);
     const days = hours / 24;
     if (days >= 1) {
       console.log(`Scheduled task '${name}' to run every ${days} day(s)`);
     } else {
       console.log(`Scheduled task '${name}' to run every ${hours} hour(s)`);
     }
  }

  // Stop a specific task
  stopTask(name) {
    if (this.intervals.has(name)) {
      clearInterval(this.intervals.get(name));
      this.intervals.delete(name);
      console.log(`Stopped task '${name}'`);
    }
  }

  // Stop all scheduled tasks
  stop() {
    console.log('Stopping scheduled tasks...');
    this.intervals.forEach((intervalId, name) => {
      clearInterval(intervalId);
      console.log(`Stopped task '${name}'`);
    });
    this.intervals.clear();
  }

  // Run auto-archive task
  async runAutoArchive() {
    try {
      console.log('Checking for auto-archive...');
      
      // Get archive configuration
      const settingsRef = db.collection('settings').doc('archive');
      const settingsDoc = await settingsRef.get();
      
      if (!settingsDoc.exists) {
        console.log('No archive configuration found, skipping auto-archive');
        return;
      }
      
      const settings = settingsDoc.data();
      
             if (!settings.autoArchive) {
         console.log('Auto-archive is disabled, skipping');
         return;
       }
       
       // Since this task runs every 24 hours, we don't need additional time checks
       const now = new Date();
      
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - settings.autoArchiveDays);
      
      console.log(`Running auto-archive for bookings older than: ${cutoffDate.toISOString()}`);
      
      // Query bookings where the service date is older than the cutoff date
      const snapshot = await db.collection('bookings')
        .where('date', '<', cutoffDate.toISOString().split('T')[0])
        .get();
      
      if (snapshot.empty) {
        console.log('No bookings found to archive');
        // Update last run timestamp even if no bookings to archive
        await settingsRef.update({
          lastAutoArchive: now
        });
        return;
      }
      
      const batch = db.batch();
      const archivedBookings = [];
      
      snapshot.docs.forEach(doc => {
        const bookingData = doc.data();
        
        // Add to archivedBookings collection
        const archivedRef = db.collection('archivedBookings').doc(doc.id);
        batch.set(archivedRef, {
          ...bookingData,
          archivedAt: now,
          originalId: doc.id,
          archiveReason: 'auto_archive'
        });
        
        // Delete from bookings collection
        batch.delete(doc.ref);
        
        archivedBookings.push({
          id: doc.id,
          date: bookingData.date,
          assignedStatus: bookingData.assignedStatus
        });
      });
      
      // Commit the batch
      await batch.commit();
      
      // Update last auto-archive timestamp
      await settingsRef.update({
        lastAutoArchive: now
      });
      
      console.log(`Auto-archive completed: ${archivedBookings.length} bookings archived`);
      
    } catch (error) {
      console.error('Error in auto-archive task:', error);
    }
  }
}

// Create and export the scheduled tasks instance
const scheduledTasks = new ScheduledTasks();

// Export the instance and also expose the checkAutoArchiveSetting method
module.exports = scheduledTasks;
module.exports.checkAutoArchiveSetting = scheduledTasks.checkAutoArchiveSetting.bind(scheduledTasks); 