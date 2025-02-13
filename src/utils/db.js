const mongoose = require('mongoose');
require("dotenv").config();

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      ssl: true,
      serverSelectionTimeoutMS: 30000, // Increase timeout to 30 seconds
      socketTimeoutMS: 45000, // Set socket timeout to 45 seconds
      connectTimeoutMS: 30000 // Set connect timeout to 30 seconds
    });
    console.log('Successfully connected to MongoDB Atlas!');
  } catch (e) {
    console.error('Error connecting to the database:', e);
    throw e;
  }
};

// Global handler for unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

module.exports = {
  connectDB,
};
