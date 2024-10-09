const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const https = require('https');
const multer = require('multer');
const sharp = require('sharp');
const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const path = require('path');

// Email Template
const React = require('react');
const ReactDOMServer = require('react-dom/server');
const Email = require('./templates/email');

// env imports
require('dotenv').config();

const bucketName = process.env.BUCKET_NAME;
const region = process.env.BUCKET_REGION;
const accessKeyId = process.env.ACCESS_KEY;
const secretAccessKey = process.env.SECRET_ACCESS_KEY;

const s3 = new S3Client({
    region,
    credentials: {
        accessKeyId,
        secretAccessKey,
    }
});

// Emails imports 
const crypto = require('crypto');
const nodemailer = require('nodemailer');

// Models
const User = require('./models/user.model');
const Profile = require('./models/profile.model');
const ResetPassword = require('./templates/resetpassword');

const app = express();

app.use(cors({ origin: '*', credentials: true }));
app.use(express.json());

const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

const generateFileName = (bytes = 32) => crypto.randomBytes(bytes).toString('hex');

// Mongoose connection
try {
    mongoose.connect('mongodb+srv://Dev123:Mikey2024@xclusivetouch.gs88nsy.mongodb.net/?retryWrites=true&w=majority&appName=XclusiveTouch');
    console.log('MongoDB connected');
} catch (err) {
    console.log(err);
}

/*
-------------
USER MODEL
-------------
*/

// Creates user, hashed password & checks for duplicate email
app.post('/api/register', async (req, res) => {
    console.log('Registering user');

    try {
        const hashedPassword = await bcrypt.hash(req.body.password, 10);
        console.log('Hashed Password:', hashedPassword); // Debug

        const confirmationToken = crypto.randomBytes(20).toString('hex');

        const user = await User.create({
            email: req.body.email,
            password: hashedPassword,
            username: req.body.username,
            isValid: true,
            confirmationToken: confirmationToken
        });

        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: process.env.EMAIL_USERNAME,
                pass: process.env.EMAIL_PASSWORD
            }
        });

        const emailHtml = ReactDOMServer.renderToStaticMarkup(
            React.createElement(Email, { userFirstname: req.body.username })
        );

        const mailOptions = {
            from: process.env.EMAIL_USERNAME,
            to: req.body.email,
            subject: 'Welcome to Xclusive Touch Digital Business Cards',
            html: emailHtml
        };

        transporter.sendMail(mailOptions, function(error, info) {
            if (error) {
                console.log(error);
            } else {
                console.log('Email sent: ' + info.response);
            }
        });

        res.json({ status: 'ok', user: user });
    } catch (err) {
        console.log(err);
        res.json({ status: 'error', error: 'Duplicate email' });
    }
});

// Confirmation email - token
app.get('/api/confirm/:token', async (req, res) => {
    try {
        const user = await User.findOne({ confirmationToken: req.params.token });

        if (!user) {
            return res.sendFile(path.join(__dirname, 'confirmation-error.html'));
        }

        user.isValid = true;
        user.confirmationToken = null;
        await user.save();

        res.sendFile(path.join(__dirname, 'confirmation-success.html'));
    } catch (err) {
        console.log(err);
        res.sendFile(path.join(__dirname, 'confirmation-error.html'));
    }
});

app.post('/api/forgotpassword', async (req, res) => {
    try {
        const user = await User.findOne({ email: req.body.email });

        if (!user) {
            return res.json({ status: 'error', error: 'User not found' });
        }

        const resetToken = crypto.randomBytes(20).toString('hex');
        user.resetToken = resetToken;
        user.resetTokenExpiration = Date.now() + 900000; // 15 minutes in milliseconds
        await user.save();

        console.log('Updated user:', user);

        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: process.env.EMAIL_USERNAME,
                pass: process.env.EMAIL_PASSWORD
            }
        });

        const emailHtml = ReactDOMServer.renderToStaticMarkup(
            React.createElement(ResetPassword, { userFirstname: user.username, id: resetToken })
        );

        const mailOptions = {
            from: process.env.EMAIL_USERNAME,
            to: req.body.email,
            subject: 'Welcome to Xclusive Touch Digital Business Cards',
            html: emailHtml
        };

        transporter.sendMail(mailOptions, function(error, info) {
            if (error) {
                console.log(error);
            } else {
                console.log('Email sent: ' + info.response);
            }
        });

        res.json({ status: 'ok', user: user });
    } catch (err) {
        console.log(err);
        res.json({ status: 'error', error: 'Unable to retrieve' });
    }
})

app.post('/api/confirmreset/:id', async (req, res) => {
    try {
        const user = await User.findOne({ resetToken: req.params.id });

        console.log(req.params.id, 'RESET TOKEN')

        if (!user) {
            return res.json({ status: 'error', error: 'User not found' });
        }

        // Check if the reset token has expired
        if (Date.now() > user.resetTokenExpiration) {
            return res.json({ status: 'error', error: 'Expired token' });
        }

        if (req.body.password !== req.body.confirmPassword) {
            return res.json({ status: 'error', error: 'Passwords do not match' });
        }

        const hashedPassword = await bcrypt.hash(req.body.password, 10);
        user.password = hashedPassword;
        user.resetToken = null;
        user.resetTokenExpiration = null;
        await user.save();

        res.json({ status: 'ok', user: user });
    } catch (err) {
        console.log(err);
        res.json({ status: 'error', error: 'Invalid token' });
    }
})

// Login user, hashed password, and create jwt token
app.post('/api/login', async (req, res) => {
    try {
    console.log('Loggin in user')

    console.log(req.body.email, req.body.password)

    const user = await User.findOne({
        email: req.body.email,
    })

    console.log(user, 'USER')

    // if (User.isValid === false) {
    //     return res.json({ status: 'error', error: 'Please confirm your email' })
    // }

    if (!user) {
        return res.json({ status: 'error', error: 'Invalid email/password' })
    }

    console.log('Stored Hashed Password:', user.password); // Debug log
    console.log('Entered Password:', req.body.password); // Debug log

    const isPasswordValid = await bcrypt.compare(req.body.password, user.password);
    console.log('Is Password Valid:', isPasswordValid); // Debug log


    console.log(isPasswordValid, 'IS PASSWORD VALID')

    if (isPasswordValid) {
        const token = jwt.sign(
            {
                name: user.name,
                email: user.email
            },
            'secret123'
        )

        res.cookie('token', token, { httpOnly: true });

        return res.json({ status: 'ok', user: user, data: token })
    } else {
        return res.json({ status: 'error', error: 'Incorrect Credentials'})
    }
} catch (err) {
    console.log(err)
    res.json({ status: 'error', error: 'Invalid email/password' })
}
})

/*
-------------
PROFILE MODEL
-------------
*/

app.get('/api/profile/:id', async (req, res) => {
    const id = req.params.id
    console.log('Getting profile')
    try {
        const user = await User.findOne({ _id: id })
        const profile = await Profile.findOne({ email: user.email })

        const params = {
            Bucket: bucketName,
            Key: profile.profile[0].colours[0].profilePhoto
        }

        const command = new GetObjectCommand(params)
        const seconds = 60
        const url = await getSignedUrl(s3, command, { expiresIn: seconds })

        // Set a timeout to generate a new pre-signed URL when the previous one expires
        setTimeout(async () => {
            const newUrl = await getSignedUrl(s3, command, { expiresIn: seconds })
            console.log('New pre-signed URL:', newUrl)
        }, seconds * 1000)

        return res.json({ status: 'ok', data: profile, url: url })
    } catch (err) {
        console.log(err)
        res.json({ status: 'error', error: 'Invalid Profile' })
    }
})

app.get('/api/publicProfile/:username', async (req, res) => {
    const username = req.params.username
    console.log('Getting public profile')
    try {
        const profile = await Profile.findOne({ username: username })

        const params = {
            Bucket: bucketName,
            Key: profile.profile[0].colours[0].profilePhoto
        }

        const command = new GetObjectCommand(params)
        const seconds = 60
        const url = await getSignedUrl(s3, command, { expiresIn: seconds })

        // Set a timeout to generate a new pre-signed URL when the previous one expires
        setTimeout(async () => {
            const newUrl = await getSignedUrl(s3, command, { expiresIn: seconds })
            console.log('New pre-signed URL:', newUrl)
        }, seconds * 1000)

        return res.json({ status: 'ok', data: profile, url: url })
    } catch (err) {
        console.log(err)
        res.json({ status: 'error', error: 'Invalid Profile' })
    }
})

app.post('/api/profile', upload.single('profilePhoto'), async (req, res) => {
    console.log('Creating or updating profile');
    console.log(req.body);


    console.log('socialMedia:', req.body.socialMedia);

    const socialMediaLinks = [];
    if (req.body.socialMedia) {
        const socialMedia = JSON.parse(req.body.socialMedia);
        socialMedia.forEach((item) => {
            const platform = item.platform;
            const link = item.link;
            if (platform) {
                socialMediaLinks.push({ [platform.toLowerCase()]: link });
            }
        });
    } else {
        console.error('req.body.socialMedia is not defined:', req.body);
    }

    try {
        const user = await User.findOne({ email: req.body.email });

        if (!user) {
            return res.status(404).json({ status: 'error', error: 'User not found' });
        }

        console.log('User:', user);

        let fileName;
        if (req.file) {
            fileName = generateFileName();

            const file = req.file;

            const fileBuffer = await sharp(file.buffer)
                .resize({ width: 750, height: 750, fit: "contain" })
                .toBuffer();

            const params = {
                Bucket: bucketName,
                Body: fileBuffer,
                Key: fileName,
                ContentType: file.mimetype,
            };

            console.log('S3 upload params:', params);

            // Send the upload to S3
            await s3.send(new PutObjectCommand(params));
        }

        // Prepare the profile data
        const profileData = {
            email: req.body.email,
            username: user.username,
            profile: {
                firstName: req.body.firstName,
                lastName: req.body.lastName,
                phoneNumber: req.body.phoneNumber,
                email: req.body.email,
                position: req.body.position,
                company: req.body.company,
                about: req.body.about,
                socialMedia: socialMediaLinks,
                colours: {
                    primaryColour: req.body.primaryColour,
                    cardColour: req.body.cardColour,
                }
            }
        };

        console.log(req.file ? 'req file found ' + fileName : 'req file not found');

        if (req.body.companyAddress) {
            profileData.profile.companyAddress = req.body.companyAddress;
        }

        // Conditionally add profilePhoto if fileName exists
        if (req.file) {
            profileData.profile.colours.profilePhoto = fileName;
        }

        const profile = await Profile.create(profileData);

        console.log('profile created', profile);

        res.json({ status: 'ok', data: profile });
    } catch (err) {
        console.log(err);
        res.json({ status: 'error', error: 'Invalid Profile' });
    }
});

app.put('/api/profile/:id', upload.single('profilePhoto'), async (req, res) => {
    const id = req.params.id;

    console.log('Updating profile');
    console.log(req.file);
    try {
        const user = await User.findOne({ _id: id });

        if (!user) {
            return res.json({ status: 'error', error: 'User not found' });
        }

        const socialMediaLinks = [];
        if (req.body.socialMedia) {
            const socialMedia = JSON.parse(req.body.socialMedia);
            socialMedia.forEach((item) => {
                const platform = item.platform;
                const link = item.link;
                if (platform) {
                    socialMediaLinks.push({ [platform.toLowerCase()]: link });
                }
            });
        } else {
            console.error('req.body.socialMedia is not defined:', req.body);
        }

        let fileName;
        if (req.file) {
            console.log('req file found');
        
            fileName = generateFileName();
        
            const file = req.file;
        
            const fileBuffer = await sharp(file.buffer)
                .resize({ width: 750, height: 750, fit: "contain" })
                .toBuffer();
        
            const params = {
                Bucket: bucketName,
                Body: fileBuffer,
                Key: fileName,
                ContentType: file.mimetype,
            };
        
            console.log('S3 upload params:', params);
        
            // Send the upload to S3
            await s3.send(new PutObjectCommand(params));
        }
        
        // Find the existing profile
        const existingProfile = await Profile.findOne({ email: req.body.email });
        
        if (!existingProfile) {
            return res.json({ status: 'error', error: 'Profile not found' });
        }
        
        // Update the profile with the new data
        const updateData = {
            'profile.$[profileElem].firstName': req.body.firstName,
            'profile.$[profileElem].lastName': req.body.lastName,
            'profile.$[profileElem].phoneNumber': req.body.phoneNumber,
            'profile.$[profileElem].email': req.body.email,
            'profile.$[profileElem].position': req.body.position,
            'profile.$[profileElem].company': req.body.company,
            'profile.$[profileElem].about': req.body.about,
            'profile.$[profileElem].socialMedia': socialMediaLinks,
            'profile.$[profileElem].colours.$[colourElem].primaryColour': req.body.primaryColour,
            'profile.$[profileElem].colours.$[colourElem].cardColour': req.body.cardColour,
        };

        if (req.body.companyAddress) {
            updateData['profile.$[profileElem].companyAddress'] = req.body.companyAddress;
        }
        
        // Conditionally update profilePhoto
        if (req.file) {
            updateData['profile.$[profileElem].colours.$[colourElem].profilePhoto'] = fileName;
        }
        
        const profile = await Profile.findOneAndUpdate(
            { email: req.body.email },
            { $set: updateData },
            {
                arrayFilters: [
                    { 'profileElem._id': existingProfile.profile[0]._id },
                    { 'colourElem._id': existingProfile.profile[0].colours[0]._id }
                ],
                new: true // Return the updated document
            }
        );
        
        console.log('Profile updated', profile);
        
        res.json({ status: 'ok', data: profile });
    } catch (err) {
        console.log(err);
        res.json({ status: 'error', error: 'Invalid Profile' });
    }
});

app.listen(8001, () => {
    console.log('Server started on port 8001')
})