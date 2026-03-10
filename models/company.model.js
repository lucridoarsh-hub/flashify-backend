import mongoose, { Schema } from "mongoose";

const CompanySchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    companyName: {
      type: String,
      required: [true, "Company name is required"],
      trim: true,
      minlength: 2,
      maxlength: 100,
    },

    companyImage: {
      type: [
        {
          public_id: {
            type: String,
            required: true,
          },
          url: {
            type: String,
            required: true,
          },
        },
      ],
      default: [],
    },

    description: {
      type: String,
      required: [true, "Description is required"],
      trim: true,
      minlength: 10,
    },
  },
  { timestamps: true }
);

// Optional: performance optimization
CompanySchema.index({ companyName: "text" });

export const CompanyList = mongoose.model("CompanyList", CompanySchema);