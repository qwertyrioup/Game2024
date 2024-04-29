import mongoose from "mongoose";

const UserType = {
  ADMIN: "admin",
  CLIENT: "client",
  SUPER: "super",
  SHOP: "shop",
};

const UserSchema = new mongoose.Schema(
  {
    username: {
      type: String,
      required: true,
      unique: true,
    },

    password: {
      type: String,
      required: true,
    },

    role: {
      type: String,
      enum: Object.values(UserType),
      required: true,
      default: UserType.CLIENT,
    },
    balance:{
      type: Number,
      default: 0,
    }
    
  },
  { timestamps: true }
);

export default mongoose.model("User", UserSchema);
