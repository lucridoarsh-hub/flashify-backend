import mongoose, { Schema } from "mongoose";
import validator from "validator";

const UserSchema = new Schema(
  {
    username: {
      type: String,
      required: true,
      trim: true,
      minlength: 3,
      maxlength: 30,
    },

    phoneNumber: {
      type: String,
      required: false,
      trim: true,
    },

    affiliateCode: {
      type: String, // optional
      trim: true,
    },

    teamMemberEmails: [
      {
        type: String,
        lowercase: true,
        trim: true,
        validate: [validator.isEmail, "Invalid email address"],
      },
    ],

    image: {
      type: String,
    },

    otp: {
      type: Number,
    },

    otpExpires: {
      type: Date,
    },

    resetPassword: {
      type: Boolean,
      default: false,
    },

    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      validate: [validator.isEmail, "Invalid email address"],
    },

    pdfLists: [
      {
        public_id: {
          type: String,
        },
        url: {
          type: String,
        },
      },
    ],

    password: {
      type: String,
      required: true,
      minlength: 6,
      select: false, // extra security
    },

    ipAddress: [
      {
        latestIP: {
          type: String,
          required: true,
        },
        oldIP: {
          type: String,
        },
        loginDate: {
          type: Date,
          default: Date.now,
        },
      },
    ],

    oldPassword: [
      {
        password: {
          type: String,
        },
        passwordDate: {
          type: Date,
          default: Date.now,
        },
      },
    ],

    role: {
      type: String,
      enum: ["user", "admin", "supplier", "freelancer", "teammate"],
      default: "user",
    },

    isVerified: {
      type: Boolean,
      default: false,
    },

    lastLogin: {
      type: Date,
    },

    company:{
      type : Boolean,
      default :  false
    },

    contractOrderList: [
      {
        type: String, // or ObjectId later
      },
    ],
  },
  { timestamps: true }
);

export const User = mongoose.models.User || mongoose.model("User", UserSchema);
