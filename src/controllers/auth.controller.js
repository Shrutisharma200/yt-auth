import userModel from "../models/user.model.js";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import config from "../config/config.js";
import sessionModel from "../models/session.model.js";
import {sendEmail} from "../services/email.services.js"
import { generateOtp, getOtpHtml } from "../utils/utils.js";
import otpModel from "../models/otp.model.js";


export async function register(req, res) {
  const { username, email, password } = req.body;

  const isAlreadyRegister = await userModel.findOne({
    $or: [
      { username },
      { email }
    ]
  });

  if (isAlreadyRegister) {
    return res.status(409).json({
      message: "Username or email already exists"
    });
  }

  // Hash password
  const hashedPassword = crypto
    .createHash("sha256")
    .update(password)
    .digest("hex");

  // Create user
  const user = await userModel.create({
    username,
    email,
    password: hashedPassword
  });

  // Generate OTP
  const otp = generateOtp();

  // Create OTP HTML
  const html = getOtpHtml(otp);

  // Hash OTP
  const otpHash = crypto
    .createHash("sha256")
    .update(otp)
    .digest("hex");

  // Save OTP in database
  await otpModel.create({
    email,
    user: user._id,
    otpHash
  });

  // Send OTP email
  await sendEmail(
    email,
    "OTP Verification",
    `Your OTP is ${otp}`,
    html
  );

  // Response
  return res.status(201).json({
    message: "User registered successfully",
    user: {
      username: user.username,
      email: user.email,
      verified: user.verified
    }
  });
}

export async function login(req, res) {
    const { email, password } = req.body;

    const user = await userModel.findOne({email})

    if(!user){
       return res.status(401).json({
            message:"Invalid email or password"
        })
    }

    if(!user.verified){
      return res.status(401).json({
        message:"Email not verified"
      })
    }

    const hashedPassword = crypto.createHash("sha256").update(password).digest("hex")


    const isPasswordValid = hashedPassword === user.password;

    if(!isPasswordValid){
        return res.status(401).json({
            message:"Invalid email or password"
        })

    }

    const refreshToken = jwt.sign({
        id:user._id
    }, config.JWT_SECRET,
   {
    expiresIn:"7d"
   })


const refreshTokenHash = crypto.createHash("sha256").update(password).digest("hex")

const session = await sessionModel.create({
    user:user._id,
    refreshTokenHash,
    ip:req.ip,
    userAgent:req.headers["user-agent"]
})

const accessToken = jwt.sign({
    id:user._id,
    sessionId:session._id
}, config.JWT_SECRET,{
    expiresIn:"15m"
})

res.cookie("refreshToken", refreshToken,{
    httpOnly:true,
    secure:true,
    sameSite:"strict",
    maxAge:7*24*60*60*1000
})

res.status(200).json({
    message:"Logged in successfully",
    user:{
        username:user.username,
        email:user.email,
    },
    accessToken,
})
}

export async function getMe(req, res){
  const token = req.headers.authorization?.split(" ")[1];

  if(!token){
    return res.status(401).json({
        message:"token not found"
    })
  }

  const decoded = jwt.verify(token, config.JWT_SECRET)
  const user = await userModel.findById(decoded.id)

   if (!user) {
    return res.status(404).json({
      message: "User not found"
    });
  }

  res.status(200).json({
    message:"user fetched successfully",
    user:{
        username:user.username,
        email:user.email,
    }
  })


}

export async function refreshToken(req, res) {
  const refreshToken = req.cookies.refreshToken;

  if (!refreshToken) {
    return res.status(401).json({
      message: "Refresh token not found"
    });
  }

  const decoded = jwt.verify(
    refreshToken,
    config.JWT_SECRET
  );

  // Hash the OLD refresh token
  const refreshTokenHash = crypto
    .createHash("sha256")
    .update(refreshToken)
    .digest("hex");

  // Find active session
  const session = await sessionModel.findOne({
    refreshTokenHash,
    revoked: false
  });

  if (!session) {
    return res.status(401).json({
      message: "Invalid refresh token"
    });
  }

  // Create new access token
  const accessToken = jwt.sign(
    {
      id: decoded.id
    },
    config.JWT_SECRET,
    {
      expiresIn: "15m"
    }
  );

  // Create new refresh token
  const newRefreshToken = jwt.sign(
    {
      id: decoded.id
    },
    config.JWT_SECRET,
    {
      expiresIn: "7d"
    }
  );

  // Hash the NEW refresh token
  const newRefreshTokenHash = crypto
    .createHash("sha256")
    .update(newRefreshToken)
    .digest("hex");

  // Save new hash in database
  session.refreshTokenHash = newRefreshTokenHash;
  await session.save();

  // Send new refresh token to browser
  res.cookie("refreshToken", newRefreshToken, {
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    maxAge: 7 * 24 * 60 * 60 * 1000
  });

  res.status(200).json({
    message: "Access token refreshed successfully",
    accessToken
  });
}

export async function logout(req, res) {
    const refreshToken = req.cookies.refreshToken;

    if(!refreshToken){
        return res.status(400).json({
            message:"Refresh token not found"
        })
    }

    const refreshTokenHash = crypto.createHash("sha256").update(refreshToken).digest("hex");

    const session = await sessionModel.findOne({
        refreshTokenHash,
        revoked:false
    })

    if(!session){
        return res.status(400).json({
            message:"Invallid refresh token"
        })
    }

    session.revoked = true;
    await session.save();

    res.clearCookie("refreshToken")

    res.status(200).json({
        message:"Logged out successfully"
    })
    
}

export async function logoutAll(req, res) {
    const refreshToken = req.cookies.refreshToken

    if(!refreshToken){
        return res.status(400).json({
            message:"Refresh token not found"
        })
    }

    const decoded = jwt.verify(refreshToken, config.JWT_SECRET)

    await sessionModel.updateMany({
        user:decoded.id,
        revoked:false
    },{
        revoked:true
    })

    res.clearCookie("refreshToken")

    res.status(200).json({
        message:"Logged out from all devices successfully"
    })


}

export async function verifyEmail(req, res) {
  const {otp, email}=req.body

  const otpHash = crypto.createHash("sha256").update(otp).digest("hex")

  const otpDoc = await otpModel.findOne({
    email,
    otpHash
  })

  if(!otpDoc){
    return res.status(400).json({
      message:"Invalid OTP"
    })
  }

  const user = await userModel.findByIdAndUpdate(otpDoc.user,{
    verified:true
  })

  await otpModel.deleteMany({
    user:otpDoc.user
  })

  return res.status(200).json({
    message:"Email verified successfully",
    user:{
      username:user.username,
      email:user.username,
      verified:user.verified
    }
  })
}