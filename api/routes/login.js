var express = require("express")
var mongo = require('../models/mongo');
var router = express.Router();
var jwt = require('jsonwebtoken');
var crypto = require('crypto');
const { OAuth2Client } = require('google-auth-library');

const { INCORRECT_PASSWORD_ERROR_MSG, NO_ACCOUNT_FOUND_ERROR_MSG, PENDING_VERIFICATION_ERROR_MSG, SERVER_ERROR_MSG, USE_GOOGLE_ERROR_MSG } = require('../constants/errors');
const { USER_PENDING_EMAIL_STATUS } = require('../constants/status')
const { GOOGLE_CLIENT_ID } = require('../constants/config');

const JWT_EXPIRY_TIME = '1h'; // change expiry time
const JWT_COOKIE_NAME = 'c_user';

const client = new OAuth2Client(GOOGLE_CLIENT_ID);

function sendToken(res, data) {
    const token = jwt.sign({
        sub: data._id,
        name: data.name
    }, process.env.JWT_SECRET_KEY, {expiresIn: JWT_EXPIRY_TIME});
    res.cookie(JWT_COOKIE_NAME, token, { 
        expires: new Date(Date.now() + 900000), // change expiry time
        httpOnly: true
    });
    res.sendStatus(200);
}

function sendError(res, status, message) {
    res.status(status);
    res.json({
        message: message
    });
}

router.post("/auth/google", async (req, res) => {
    const { token }  = req.body;
    console.log(req.body);
    // Verify Google Token
    client.verifyIdToken({
        idToken: token,
        audience: GOOGLE_CLIENT_ID
    })
    .then(ticket => {
        // Find google id in database
        const { sub } = ticket.getPayload();
        const options = {
            projection: {
                _id: 1,
                name: 1,
                status: 1
            }
        }
        mongo.findUser({ google_id: sub}, options)
        .then((data) => {
            if (data == null) {
                sendError(res, 401, NO_ACCOUNT_FOUND_ERROR_MSG);
            }
            else if (data.status == USER_PENDING_EMAIL_STATUS) {
                sendError(res, 401, PENDING_VERIFICATION_ERROR_MSG);
            }
            else {
                // successfully verified google token and found in db
                sendToken(res, data);
            }
        });
    })
    .catch(error => {
        sendError(res, 500, SERVER_ERROR_MSG);
    });
})

router.post("/auth", async (req, res) => {
    const base64credentials = req.headers.authorization.split(' ')[1]
    const credentials = Buffer.from(base64credentials, 'base64').toString('ascii');
    const [email, password] = credentials.split(':');
    const options = {
        projection: {
            _id: 1,
            email: 1,
            hash: 1,
            name: 1,
            google_id: 1,
            status: 1
        }
    }

    // find email in database
    mongo.findUser({ email: email }, options)
    .then(data => {
        if (!data) {
            sendError(res, 401, NO_ACCOUNT_FOUND_ERROR_MSG);
        }
        else if (!!data.google_id) {
            sendError(res, 401, USE_GOOGLE_ERROR_MSG);
        }
        else {
            // hash provided password and check against hash stored in database
            const [hash, salt] = data.hash.split(':');
            crypto.pbkdf2(password, Buffer.from(salt, 'hex'), 10000, 16, 'sha512', (err, derivedKey) => {
                if (err) {
                    throw err;
                }
                if (derivedKey.toString('hex') === hash) {
                    if (data.status === USER_PENDING_EMAIL_STATUS) {
                        sendError(res, 401, PENDING_VERIFICATION_ERROR_MSG);
                    }
                    else {
                        sendToken(res, data);
                    }
                }
                else {
                    sendError(res, 401, INCORRECT_PASSWORD_ERROR_MSG); // can change error messages later
                }
            });
        }
    })
    .catch(err => {
        sendError(res, 500, SERVER_ERROR_MSG);
    });
 
})

module.exports = router;