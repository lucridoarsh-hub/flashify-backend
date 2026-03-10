
import { User } from '../models/auth.model.js'; // adjust the path if needed
import bcrypt from 'bcryptjs';
import { v2 as cloudinary } from 'cloudinary';
import nodemailer from 'nodemailer'
import jwt from 'jsonwebtoken';
import { transporter } from '../util/EmailTransporter.js';
import fs from 'fs';
import path from 'path';

import mongoose from 'mongoose';
import { ProjectData } from '../models/project.model.js';
import { ProjectOrder } from '../models/ProjectOrder.model.js';
import { CompanyList } from '../models/company.model.js';
cloudinary.config({
  cloud_name: process.env.CLOUDNARY_NAME,
  api_key: process.env.CLOUDNARY_API,
  api_secret: process.env.CLOUDNARY_SECRET,
});
export const UploadProjectPdf = async (req, res) => {
  try {
    console.log('Request received:', {
      method: req.method,
      url: req.url,
      headers: req.headers,
      params: req.params,
      body: req.body,
    });

    const { userId } = req.params;
    const { Name, Code, Color, data } = req.body;

    // Parse QuantitiesAndLengths from FormData fields
    const QuantitiesAndLengths = [];
    const bodyKeys = Object.keys(req.body);
    const quantityKeys = bodyKeys.filter((key) => key.match(/^QuantitiesAndLengths\[\d+\]\[quantity\]$/));
    for (const quantityKey of quantityKeys) {
      const index = quantityKey.match(/\[(\d+)\]/)[1];
      const lengthKey = `QuantitiesAndLengths[${index}][length]`;
      if (bodyKeys.includes(lengthKey)) {
        QuantitiesAndLengths.push({
          quantity: req.body[quantityKey],
          length: req.body[lengthKey],
        });
      }
    }

    console.log('Parsed QuantitiesAndLengths:', QuantitiesAndLengths);

    // Validate userId
    if (!userId) {
      console.log('Validation failed: userId is required');
      return res.status(400).json({ message: 'userId is required' });
    }

    // Validate body fields
    const requiredFields = { Name, Code, Color, QuantitiesAndLengths };
    const missingField = Object.entries(requiredFields).find(([key, value]) => !value);
    if (missingField) {
      console.log(`Validation failed: ${missingField[0]} is required`);
      return res.status(400).json({ message: `${missingField[0]} is required` });
    }

    // Validate QuantitiesAndLengths array
    if (!Array.isArray(QuantitiesAndLengths) || QuantitiesAndLengths.length === 0) {
      console.log('Validation failed: QuantitiesAndLengths must be a non-empty array');
      return res.status(400).json({ message: 'QuantitiesAndLengths must be a non-empty array' });
    }

    for (const item of QuantitiesAndLengths) {
      if (!item.quantity || !item.length) {
        console.log('Validation failed: Each item in QuantitiesAndLengths must have quantity and length');
        return res.status(400).json({
          message: 'Each item in QuantitiesAndLengths must have quantity and length',
        });
      }
    }

    // Parse data if it's a string
    let parsedData;
    try {
      parsedData = typeof data === 'string' ? JSON.parse(data) : data;
    } catch (error) {
      console.log('Validation failed: Invalid data JSON:', error.message);
      return res.status(400).json({ message: 'Invalid data format' });
    }

    // Check if user exists
    const userExists = await User.exists({ _id: userId });
    if (!userExists) {
      console.log('Validation failed: User not found for userId:', userId);
      return res.status(404).json({ message: 'User not found' });
    }

    // Save project to DB
    const savedProject = await ProjectData.create({
      userId,
      Name,
      Code,
      Color,
      QuantitiesAndLengths,
      data: parsedData,
    });

    console.log('Project saved:', savedProject);

    return res.status(201).json({
      message: 'Project uploaded successfully',
      project: savedProject,
    });
  } catch (error) {
    console.error('UploadProjectPdf error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};
export const updateUploadProjectPdf = async (req, res) => {
  try {
    console.log('Request received:', {
      method: req.method,
      url: req.url,
      headers: req.headers,
      params: req.params,
      body: req.body,
    });

    const { userId,orderId } = req.params;

    const { Name, Code, Color, data } = req.body;

    // Parse QuantitiesAndLengths from FormData fields
    const QuantitiesAndLengths = [];
    const bodyKeys = Object.keys(req.body);
    const quantityKeys = bodyKeys.filter((key) => key.match(/^QuantitiesAndLengths\[\d+\]\[quantity\]$/));
    for (const quantityKey of quantityKeys) {
      const index = quantityKey.match(/\[(\d+)\]/)[1];
      const lengthKey = `QuantitiesAndLengths[${index}][length]`;
      if (bodyKeys.includes(lengthKey)) {
        QuantitiesAndLengths.push({
          quantity: req.body[quantityKey],
          length: req.body[lengthKey],
        });
      }
    }

    console.log('Parsed QuantitiesAndLengths:', QuantitiesAndLengths);

    // Validate userId
    if (!userId) {
      console.log('Validation failed: userId is required');
      return res.status(400).json({ message: 'userId is required' });
    }

    // Validate body fields
    const requiredFields = { Name, Code, Color, QuantitiesAndLengths };
    const missingField = Object.entries(requiredFields).find(([key, value]) => !value);
    if (missingField) {
      console.log(`Validation failed: ${missingField[0]} is required`);
      return res.status(400).json({ message: `${missingField[0]} is required` });
    }

    // Validate QuantitiesAndLengths array
    if (!Array.isArray(QuantitiesAndLengths) || QuantitiesAndLengths.length === 0) {
      console.log('Validation failed: QuantitiesAndLengths must be a non-empty array');
      return res.status(400).json({ message: 'QuantitiesAndLengths must be a non-empty array' });
    }
    const findOrder = await ProjectOrder.findById(orderId)
    if(!findOrder){
      return res.status(400).json({message:"Order not found"})
    }
    for (const item of QuantitiesAndLengths) {
      if (!item.quantity || !item.length) {
        console.log('Validation failed: Each item in QuantitiesAndLengths must have quantity and length');
        return res.status(400).json({
          message: 'Each item in QuantitiesAndLengths must have quantity and length',
        });
      }
    }

    // Parse data if it's a string
    let parsedData;
    try {
      parsedData = typeof data === 'string' ? JSON.parse(data) : data;
    } catch (error) {
      console.log('Validation failed: Invalid data JSON:', error.message);
      return res.status(400).json({ message: 'Invalid data format' });
    }

    // Check if user exists
    const userExists = await User.exists({ _id: userId });
    if (!userExists) {
      console.log('Validation failed: User not found for userId:', userId);
      return res.status(404).json({ message: 'User not found' });
    }

    // Save project to DB
   // Save project to DB
const savedProject = await ProjectData.create({
  userId,
  Name,
  Code,
  Color,
  QuantitiesAndLengths,
  data: parsedData,
});

// Add project reference to order
findOrder.ProjectIds.push(savedProject._id);
await findOrder.save();

console.log('Project saved and linked to order:', savedProject);

return res.status(201).json({
  message: 'Project uploaded successfully',
  project: savedProject,
});

  } catch (error) {
    console.error('UploadProjectPdf error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

export const UpdateProfile = async (req, res) => {
  try {
    // Extract token from header
    const {token} = req.params // e.g., Bearer <token>

    if (!token) {
      return res.status(401).json({ message: "Token missing" });
    }

    const decoded = jwt.verify(token, process.env.SECRET_TOKEN_KEY);
    if (!decoded?.userId) {
      return res.status(400).json({ message: "Invalid token" });
    }

    const findUser = await User.findById(decoded.userId).select("-password");
    if (!findUser) {
      return res.status(404).json({ message: "User not found" });
    }

    const { username, password } = req.body;

    // Update username if provided
    if (username) {
      findUser.username = username;
    }

    // Update password securely
    if (password) {
      const hashedPassword = await bcrypt.hash(password, 10);
      findUser.password = hashedPassword;
    }

    // Update profile photo if provided
    if (req.files?.photo) {
      const photo = req.files.photo;
      const uploadPhoto = await cloudinary.uploader.upload(photo.tempFilePath);
      findUser.image = uploadPhoto.secure_url;
    }

    await findUser.save();
    return res.status(200).json({ message: "Profile updated successfully" });

  } catch (error) {
    console.log("❌ UpdateProfile error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};


export const register = async (req, res) => {
  try {
    const {
      username,
      email,
      password,
      phoneNumber,
      affiliateCode,
      teamMemberEmails,
    } = req.body;

    const clientIP =
      req.headers["x-forwarded-for"]?.split(",")[0] ||
      req.socket?.remoteAddress ||
      req.ip;

    // 🔹 Required field validation
    if (!username || !email || !password || !phoneNumber) {
      return res.status(400).json({
        message: "Username, email, password, and phone number are required",
      });
    }

    // 🔹 Phone format validation (+XXXXXXXXXX)
    const phoneRegex = /^\+\d{8,15}$/;
    if (!phoneRegex.test(phoneNumber)) {
      return res.status(400).json({
        message: "Phone number must include country code (e.g. +912345678901)",
      });
    }

    // 🔹 Check if user already exists
    const existingUser = await User.findOne({
      $or: [{ email }, { username }, { phoneNumber }],
    });

    if (existingUser) {
      return res.status(409).json({
        message: "User already exists with this email, username, or phone number",
      });
    }

    // 🔹 Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // 🔹 Create user
    const newUser = new User({
      username,
      email,
      phoneNumber,
      affiliateCode: affiliateCode || undefined,
      teamMemberEmails: teamMemberEmails || [],
      password: hashedPassword,

      ipAddress: [
        {
          latestIP: clientIP,
          loginDate: new Date(),
        },
      ],

      oldPassword: [
        {
          password: hashedPassword,
          passwordDate: new Date(),
        },
      ],

      lastLogin: new Date(),
    });

    await newUser.save();

    // 🔹 Generate JWT (mobile-friendly)
    const token = jwt.sign(
      { userId: newUser._id, role: newUser.role },
      process.env.SECRET_TOKEN_KEY,
      { expiresIn: "7d" }
    );

    return res.status(201).json({
      message: "User registered successfully",
      userId: newUser._id,
      company :  newUser.company,
      role: newUser.role,
      token,
    });
  } catch (error) {
    console.error("Register error:", error);
    return res.status(500).json({
      message: "Internal server error",
    });
  }
};




const loginAttempts = {}; // in-memory (OK for now)

export const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    const clientIP =
      req.headers["x-forwarded-for"]?.split(",")[0] ||
      req.socket?.remoteAddress ||
      req.ip;

    // 🔹 Validation
    if (!email || !password) {
      return res.status(400).json({
        message: "Email and password are required",
      });
    }

    // 🔹 Rate limiting (per IP)
    const now = Date.now();
    const attempts = loginAttempts[clientIP] || [];
    const recentAttempts = attempts.filter((t) => now - t < 60 * 1000);

    if (recentAttempts.length >= 4) {
      return res.status(429).json({
        message: "Too many login attempts. Try again after 60 seconds.",
      });
    }

    loginAttempts[clientIP] = [...recentAttempts, now];

    // 🔹 Find user WITH password
    const user = await User.findOne({ email }).select("+password");

    if (!user) {
      return res.status(401).json({
        message: "Invalid credentials",
      });
    }

    // 🔹 Compare password
    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return res.status(401).json({
        message: "Invalid credentials",
      });
    }

    // 🔹 Track IP history
    user.ipAddress.unshift({
      latestIP: clientIP,
      oldIP: user.ipAddress[0]?.latestIP || "",
      loginDate: new Date(),
    });

    // 🔹 Update last login
    user.lastLogin = new Date();

    await user.save();

    // 🔹 Generate JWT
    const token = jwt.sign(
      { userId: user._id, role: user.role },
      process.env.SECRET_TOKEN_KEY,
      { expiresIn: "7d" }
    );

    return res.status(200).json({
      message: "Login successful",
      userId: user._id,
      role: user.role,
      company : user.company,
      token,
    });
  } catch (error) {
    console.error("Login error:", error);
    return res.status(500).json({
      message: "Internal server error",
    });
  }
};


export const Profile = async (req, res) => {
  try {
    const token = req.params.token; // ✅ correctly access token

    const decoded = jwt.verify(token, process.env.SECRET_TOKEN_KEY);
    if (!decoded?.userId) {
      return res.status(400).json({ message: "Invalid token" });
    }

    const findUser = await User.findById(decoded.userId).select('-password');
    if (!findUser) {
      return res.status(404).json({ message: "User not found" });
    }

    res.status(200).json({
      message: "Profile fetched successfully",
      findUser,
    });

  } catch (error) {
    console.error("Profile error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// export const sendEmail = async (req, res) => {
//   try {
//     const info = await transporter.sendMail({
//       from: '"Test Sender" <nsouajg6pjadchtq@ethereal.email>',
//       to: 'ansariarsh325@gmail.com',
//       subject: 'Hello from Ethereal!',
//       text: 'This is a plain text message.',
//       html: '<h1>This is an HTML message</h1>',
//     });

//     console.log('Message sent: %s', info.messageId);
//     console.log('Preview URL: %s', nodemailer.getTestMessageUrl(info));

//     return res.status(200).json({
//       message: 'Email sent successfully',
//       preview: nodemailer.getTestMessageUrl(info),
//     });
//   } catch (error) {
//     console.error('Error sending email:', error);
//     return res.status(500).json({ message: 'Internal Server Error' });
//   }
// };

export const addTeamMemberEmail = async (req, res) => {
  try {
    const { userId } = req.params;

    // Check for valid userId
    if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ message: "Valid userId is required" });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    let { emails } = req.body; // Accepts `emails` as a field

    if (!emails) {
      return res.status(400).json({ message: "Emails are required" });
    }

    // If it's a comma-separated string, convert to array
    if (typeof emails === 'string') {
      emails = emails.split(',').map(email => email.trim());
    }

    if (!Array.isArray(emails) || emails.length === 0) {
      return res.status(400).json({ message: "Emails must be a non-empty array" });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const addedEmails = [];

    emails.forEach(email => {
      if (
        emailRegex.test(email) &&
        !user.teamMemberEmails.includes(email)
      ) {
        user.teamMemberEmails.push(email);
        addedEmails.push(email);
      }
    });

    if (addedEmails.length === 0) {
      return res.status(409).json({ message: "No valid or new emails to add" });
    }

    await user.save();

    return res.status(200).json({
      message: "Emails added successfully",
      addedEmails,
      allTeamMemberEmails: user.teamMemberEmails
    });

  } catch (error) {
    console.error("addTeamMemberEmail error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};


export const UpdateJobOrder = async (req, res) => {
  try {
    const { userId, orderId } = req.params;
    const { JobReference, Number, OrderContact, OrderDate, DeliveryAddress } = req.body;

    // 1️⃣ Validate IDs
    if (!userId || !orderId) {
      return res.status(400).json({ message: "userId and orderId are required" });
    }

    // 2️⃣ Check if user exists
    const findUser = await User.findById(userId);
    if (!findUser) {
      return res.status(404).json({ message: "User not found" });
    }

    // 3️⃣ Prepare update data (only include provided fields)
    const updateData = {};
    if (JobReference) updateData.JobReference = JobReference;
    if (Number) updateData.Number = Number;
    if (OrderContact) updateData.OrderContact = OrderContact;
    if (OrderDate) updateData.OrderDate = OrderDate;
    if (DeliveryAddress) updateData.DeliveryAddress = DeliveryAddress;

    // 4️⃣ Update order
    const updatedOrder = await ProjectOrder.findByIdAndUpdate(
      orderId,
      { $set: updateData },
      { new: true, runValidators: true }
    );

    if (!updatedOrder) {
      return res.status(404).json({ message: "Order not found" });
    }

    return res.status(200).json({
      message: "Job order updated successfully",
      order: updatedOrder
    });

  } catch (error) {
    console.error("UpdateJobOrder error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};


export const sendPdfToTeamFromEmail = async (req, res) => {
  try {
    const { userId } = req.params;
    const { JobReference, Number, OrderContact, OrderDate, DeliveryAddress, emails } = req.body;

    // 1️⃣ Validate inputs
    if (!JobReference || !Number || !OrderContact || !OrderDate || !DeliveryAddress) {
      return res.status(400).json({ message: "All fields are required" });
    }
    if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ message: "Valid userId is required" });
    }

    // 2️⃣ Find user
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    // 3️⃣ Validate email list
    let emailList = emails;
    if (!emailList) return res.status(400).json({ message: "Emails are required" });
    if (typeof emailList === "string") {
      emailList = emailList.split(",").map(e => e.trim()).filter(Boolean);
    }
    if (!Array.isArray(emailList) || emailList.length === 0) {
      return res.status(400).json({ message: "Emails must be a non-empty array" });
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const invalidEmails = emailList.filter(email => !emailRegex.test(email));
    if (invalidEmails.length > 0) {
      return res.status(400).json({ message: "Invalid emails", invalidEmails });
    }

    // 4️⃣ Validate PDF file
    if (!req.files || !req.files.pdf) {
      return res.status(400).json({ message: "PDF file is required" });
    }
    const pdf = req.files.pdf;
    const tempPath = pdf.tempFilePath || pdf.path;

    // 5️⃣ Upload PDF to Cloudinary
    const uploadedPdf = await cloudinary.uploader.upload(tempPath, {
      resource_type: "raw", // PDFs need 'raw' type
      access_mode: "public"
    });

    // 6️⃣ Send email with PDF ATTACHMENT
    const info = await transporter.sendMail({
      from: `"${user.name}" <${user.email}>`,
      to: emailList,
      subject: "New Flashing Order",
      html: `
        <p>Please find the attached flashing order PDF.</p>
        <p>info@commercialroofers.net.au | 0421259430</p>
        <p>
          Job Reference: ${JobReference}<br>
          Number: ${Number}<br>
          Order Contact: ${OrderContact}<br>
          Order Date: ${OrderDate}<br>
          Delivery Address: ${DeliveryAddress}
        </p>
      `,
      attachments: [
        {
          filename: `${JobReference || "FlashingOrder"}.pdf`,
          path: tempPath, // Send from temp file directly
          contentType: "application/pdf"
        }
      ]
    });

    // 7️⃣ Save order in DB
    await new ProjectOrder({
      userId: user._id,
      pdf: uploadedPdf.secure_url,
      JobReference,
      Number,
      OrderContact,
      OrderDate,
      DeliveryAddress,
    }).save();

    // 8️⃣ Delete temp file
    fs.unlink(tempPath, (err) => {
      if (err) console.error("Failed to delete temp file:", err);
    });

    res.status(200).json({ message: "PDF sent successfully", info });
  } catch (error) {
    console.error("sendPdfToTeamFromEmail error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};



export const fetchTeamEmails = async (req, res) => {
  try {
    const { userId } = req.params;
    if (!userId) {
      return res.status(400).json({ message: "userId is required" });
    }

    const findUser = await User.findById(userId).select('teamMemberEmails');
    if (!findUser) {
      return res.status(404).json({ message: "User not found" });
    }

    return res.status(200).json({
      message: "Team email fetched successfully",
      teamMemberEmails: findUser.teamMemberEmails,
    });
  } catch (error) {
    console.log("fetchTeamEmails error", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const UploadProjectData = async (req, res) => {
  try {
    const { userId } = req.params;
    const { projectData, Name, Code, Color, Quantity, TotalLength } = req.body;
    
    // Validate inputs
    if (!userId) {
      return res.status(400).json({ message: "userId is required" });
    }
    if (!Name || !Code || !Color || !Quantity || !TotalLength) {
      return res.status(400).json({ message: "All fields are required" });
    }
    if (!projectData || typeof projectData !== "object") {
      return res.status(400).json({ message: "projectData must be a valid object" });
    }

    // Check if user exists
    const userExists = await User.exists({ _id: userId });
    if (!userExists) {
      return res.status(404).json({ message: "User not found" });
    }

    // Save project
    const savedProject = await ProjectData.create({
      userId,
      data: projectData,
      Name,
      Code,
      Color,
      Quantity,
      TotalLength
    });

    return res.status(201).json({
      message: "Project uploaded successfully",
      project: savedProject
    });
  } catch (error) {
    console.error("UploadProjectData error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const fetchUploadProjectData = async (req, res) => {
  try {
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({ message: "userId is required" });
    }

    const projects = await ProjectData.find({ userId });

    if (projects.length === 0) {
      return res.status(404).json({ message: "Project data not found" });
    }

    return res.status(200).json({
      message: "Data fetched successfully",
      projects
    });

  } catch (error) {
    console.error("fetchUploadProjectData error", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const fetchSelectedProjectData = async (req, res) => {
  try {
    const { userId, projectId } = req.params;

    if (!userId || !projectId) {
      return res.status(400).json({ message: "userId and projectId are required" });
    }

    // Check if user exists
    const userExists = await User.exists({ _id: userId });
    if (!userExists) {
      return res.status(404).json({ message: "User not found" });
    }

    // Find project and ensure it belongs to this user
    const project = await ProjectOrder.findOne({ _id: projectId, userId:userId }).populate("ProjectIds");
    if (!project) {
      return res.status(404).json({ message: "Project not found for this user" });
    }

    return res.status(200).json({
      message: "Project fetched successfully",
      project
    });

  } catch (error) {
    console.error("fetchSelectedProjectData error", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};
export const fetchUploadOrder = async (req, res) => {
  try {
    const { userId } = req.params;

    // 1️⃣ Validate
    if (!userId) {
      return res.status(400).json({ message: "userId is required" });
    }

    // 2️⃣ Check user
    const findUser = await User.findById(userId);
    if (!findUser) {
      return res.status(404).json({ message: "User not found" });
    }

    // 3️⃣ Fetch orders
    const orders = await ProjectOrder.find({ userId });
    if (!orders.length) {
      return res.status(404).json({ message: "No orders found" });
    }

    // 4️⃣ Success
    return res.status(200).json({
      message: "Orders fetched successfully",
      orders
    });

  } catch (error) {
    console.error("fetchUploadOrder error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};
export const forgetPassword = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ message: "Email is required" });
    }

    const findUser = await User.findOne({ email });
    if (!findUser) {
      return res.status(400).json({ message: "Email not found" });
    }

    const otp = Math.floor(100000 + Math.random() * 900000);
    const otpExpires = Date.now() + 5 * 60 * 1000; // 5 minutes

    findUser.otp = otp;
    findUser.otpExpires = otpExpires;
    findUser.resetPassword = false;
    await findUser.save();

    // Create a modern HTML email template for OTP
    const htmlTemplate = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Password Reset OTP - Commercial Roofers</title>
        <style>
          body { font-family: Arial, sans-serif; background-color: #f4f4f4; margin: 0; padding: 0; }
          .container { max-width: 600px; margin: 20px auto; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1); }
          .header { background-color: #2563eb; color: #ffffff; padding: 20px; text-align: center; }
          .header h1 { margin: 0; font-size: 24px; }
          .content { padding: 20px; }
          .content p { font-size: 16px; color: #333333; line-height: 1.6; }
          .otp-box { background-color: #f9fafb; border: 1px solid #dddddd; border-radius: 4px; padding: 15px; text-align: center; font-size: 24px; font-weight: bold; color: #0f172a; margin: 20px 0; }
          .footer { background-color: #f9fafb; padding: 15px; text-align: center; font-size: 14px; color: #777777; }
          .footer a { color: #2563eb; text-decoration: none; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Password Reset OTP</h1>
          </div>
          <div class="content">
            <p>Dear User,</p>
            <p>You have requested to reset your password for your Commercial Roofers account. Please use the following One-Time Password (OTP) to proceed:</p>
            <div class="otp-box">${otp}</div>
            <p>This OTP is valid for the next 5 minutes. If you did not request this, please ignore this email or contact support.</p>
            <p>If you have any questions, feel free to contact us at info@commercialroofers.net.au or 0421259430.</p>
            <p>Best regards,<br>Commercial Roofers Pty Ltd Team</p>
          </div>
          <div class="footer">
            &copy; ${new Date().getFullYear()} Commercial Roofers Pty Ltd. All rights reserved.<br>
            <a href="https://commercialroofers.net.au">Visit our website</a>
          </div>
        </div>
      </body>
      </html>
    `;

    await transporter.sendMail({
      from: '"Commercial Roofers" <no-reply@yourdomain.com>',
      to: email,
      subject: 'Reset Password OTP',
      text: `Your OTP for password reset is: ${otp}`,
      html: htmlTemplate,
    });

    res.status(200).json({ message: "OTP sent successfully" });
  } catch (error) {
    console.error("forgetPassword error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};
export const resetPasswordOtpVerify = async (req, res) => {
  try {
    const { email, otp } = req.body;
    if (!email || !otp) {
      return res.status(400).json({ message: "Email and OTP are required" });
    }

    const findUser = await User.findOne({ email });
    if (!findUser) {
      return res.status(400).json({ message: "User not found" });
    }

    // Check OTP match and expiry
    if (
      findUser.otp !== parseInt(otp) ||
      !findUser.otpExpires ||
      findUser.otpExpires < Date.now()
    ) {
      return res.status(400).json({ message: "Invalid or expired OTP" });
    }

    findUser.resetPassword = true;
    findUser.otp = undefined;
    findUser.otpExpires = undefined;
    await findUser.save();

    res.status(200).json({ message: "OTP verified successfully" });
  } catch (error) {
    console.log("resetPasswordOtpVerify error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};
export const resetPassword = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ message: "Email and password are required" });
    }

    const findUser = await User.findOne({ email });
    if (!findUser) {
      return res.status(400).json({ message: "User not found" });
    }

    if (!findUser.resetPassword) {
      return res.status(400).json({ message: "OTP not verified or reset not allowed" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    findUser.password = hashedPassword;
    findUser.resetPassword = false;
    await findUser.save();

    const token = jwt.sign({ userId: findUser._id }, process.env.SECRET_TOKEN_KEY, {
      expiresIn: '7d',
    });

    res.status(200).json({
      message: "Password reset successfully",
      userId: findUser._id,
      token,
    });
  } catch (error) {
    console.log("resetPassword error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const CreateCompany = async (req, res) => {
  try {
    const { userId } = req.params;

    // ✅ Check if user exists
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const { companyName, description } = req.body;

    // ✅ Validate required fields
    if (!companyName || !description) {
      return res.status(400).json({
        message: "Company name and description are required",
      });
    }

    // 🚫 Prevent duplicate company profile
    const existingCompany = await CompanyList.findOne({ userId });
    if (existingCompany) {
      return res.status(400).json({
        message: "Company profile already exists",
      });
    }

    // ✅ Upload Images (if provided)
    let uploadedImages = [];

    if (req.files?.companyImage) {
      const files = Array.isArray(req.files.companyImage)
        ? req.files.companyImage
        : [req.files.companyImage];

      for (const file of files) {
        const result = await cloudinary.uploader.upload(
          file.tempFilePath,
          { folder: "companies" }
        );

        uploadedImages.push({
          public_id: result.public_id,
          url: result.secure_url,
        });
      }
    }

    // ✅ Create Company
    const company = await CompanyList.create({
      userId,
      companyName,
      description,
      companyImage: uploadedImages,
    });

    // ✅ (Optional) Update user role if your system supports company role
    user.company = true;
    await user.save();

    return res.status(201).json({
      message: "Company created successfully",
      company,
    });

  } catch (error) {
    console.error("❌ CreateCompany error:", error);
    return res.status(500).json({
      message: "Internal server error",
    });
  }
};

export const UpdateCompany = async (req, res) => {
  try {
    const { companyId } = req.params;
    const { companyName, description } = req.body;

    const company = await CompanyList.findById(companyId);

    if (!company) {
      return res.status(404).json({ message: "Company not found" });
    }

    // ✅ Check if at least one field is provided
    const hasImages =
      req.files?.companyImage &&
      (Array.isArray(req.files.companyImage)
        ? req.files.companyImage.length > 0
        : true);

    if (!companyName && !description && !hasImages) {
      return res.status(400).json({
        message:
          "At least one of companyName, description, or companyImage is required",
      });
    }

    // ✅ Update fields if provided
    if (companyName) company.companyName = companyName;
    if (description) company.description = description;

    // ✅ Upload new images if provided
    if (hasImages) {
      const files = Array.isArray(req.files.companyImage)
        ? req.files.companyImage
        : [req.files.companyImage];

      for (const file of files) {
        const result = await cloudinary.uploader.upload(
          file.tempFilePath,
          { folder: "companies" }
        );

        company.companyImage.push({
          public_id: result.public_id,
          url: result.secure_url,
        });
      }
    }

    await company.save();

    return res.status(200).json({
      message: "Company updated successfully",
      company,
    });

  } catch (error) {
    console.error("❌ UpdateCompany error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const DeleteCompany = async (req, res) => {
  try {
    const { companyId } = req.params;

    const company = await CompanyList.findById(companyId);

    if (!company) {
      return res.status(404).json({ message: "Company not found" });
    }

    // Delete images from Cloudinary
    for (const image of company.companyImage) {
      await cloudinary.uploader.destroy(image.public_id);
    }

    // Delete company from DB
    await CompanyList.findByIdAndDelete(companyId);

    // Optional: reset user flag
    const user = await User.findById(company.userId);
    if (user) {
      user.company = false;
      await user.save();
    }

    return res.status(200).json({
      message: "Company deleted successfully",
    });

  } catch (error) {
    console.error("❌ DeleteCompany error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const GetMyCompany = async (req, res) => {
  try {
    const { userId } = req.params;

    const company = await CompanyList.findOne({ userId });

    if (!company) {
      return res.status(404).json({ message: "Company not found" });
    }

    return res.status(200).json(company);

  } catch (error) {
    console.error("❌ GetMyCompany error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};