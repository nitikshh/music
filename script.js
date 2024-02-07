const express = require('express');
const app = express();
const port = process.env.PORT || 3000;
const path = require('path');
const admin = require('firebase-admin');
const multer = require('multer');
const serviceAccount = require("./serviceAccountKey.json");

// Initialize Firebase Admin SDK
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: "https://musify-d9098-default-rtdb.firebaseio.com",
    storageBucket: "musify-d9098.appspot.com" // Specify your storage bucket name here
});

// Initialize Firebase Realtime Database
const db = admin.database();
const songsRef = db.ref('songs');

// Set up Multer for handling file uploads
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// Serve static files
app.use(express.static(path.join(__dirname, 'static')));

// Handle GET request to fetch uploaded songs
app.get('/songs', (req, res) => {
    songsRef.once('value', (snapshot) => {
        const songs = [];
        snapshot.forEach((childSnapshot) => {
            const song = childSnapshot.val();
            songs.push(song);
        });
        res.json(songs);
    }, (error) => {
        res.status(500).send('Error fetching songs from database: ' + error.message);
    });
});
// Handle DELETE request to delete a song and its image
app.delete('/delete/:songName', async (req, res) => {
    const songName = req.params.songName;

    try {
        // First, delete the song entry from the database
        await songsRef.orderByChild('name').equalTo(songName).once('value', async (snapshot) => {
            snapshot.forEach(async (childSnapshot) => {
                const songId = childSnapshot.key;
                // Remove the song entry from the database
                await songsRef.child(songId).remove();
            });
        });

        // Then, delete the corresponding song file and image from storage
        const bucket = admin.storage().bucket();
        const songFile = bucket.file(songName);
        const songImage = bucket.file(songName + '_image'); // Assuming song image file name is same as song name with _image suffix
        await Promise.all([songFile.delete(), songImage.delete()]); // Delete both files concurrently

        res.sendStatus(200); // Send success response
    } catch (error) {
        return res.status(500).send('Error deleting song: ' + error.message);
    }
});

// Handle song upload
app.post('/upload', upload.fields([{ name: 'songFile', maxCount: 1 }, { name: 'songImage', maxCount: 1 }]), async (req, res) => {
    if (!req.files || !req.files.songFile || !req.files.songImage) {
        return res.status(400).send('Both song file and image must be uploaded.');
    }

    // Get form data
    const { songName, songWriter, songType } = req.body; // Add songType
    const songFile = req.files.songFile[0];
    const songImage = req.files.songImage[0];

    try {
        // Upload song file to Firebase Storage
        const bucket = admin.storage().bucket();
        const songFileStream = bucket.file(songFile.originalname).createWriteStream({
            metadata: {
                contentType: songFile.mimetype,
            }
        });
        songFileStream.end(songFile.buffer);

        // Get the download URL for the song file
        const songUrl = await bucket.file(songFile.originalname).getSignedUrl({
            action: 'read',
            expires: '03-09-2491', // Adjust expiration date as needed
        });

        // Upload song image to Firebase Storage
        const songImageStream = bucket.file(songImage.originalname).createWriteStream({
            metadata: {
                contentType: songImage.mimetype,
            }
        });
        songImageStream.end(songImage.buffer);

        // Get the download URL for the song image
        const songImageUrl = await bucket.file(songImage.originalname).getSignedUrl({
            action: 'read',
            expires: '03-09-2491', // Adjust expiration date as needed
        });

        // Save song details to Firebase Realtime Database
        songsRef.push({ name: songName, writer: songWriter, type: songType, url: songUrl[0], imageUrl: songImageUrl[0] }, (error) => {
            if (error) {
                res.status(500).send('Error saving song to database.');
            } else {
                res.status(200).send('Song uploaded successfully.');
            }
        });
    } catch (error) {
        res.status(500).send('Error uploading file to storage: ' + error.message);
    }
});


// Serve the index.html file for the root path
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'static', 'public', 'index.html'));
});


// Start server
app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});
