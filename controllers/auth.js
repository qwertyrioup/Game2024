import bcrypt from "bcryptjs";
import User from "../models/User.js";
import jwt from "jsonwebtoken";
import { createError } from "./error.js";

export const createAccount = async (req, res, next) => {
  try {
    const salt = bcrypt.genSaltSync(10);
    const hash = bcrypt.hashSync(req.body.password, salt);
    const newUser = new User({ ...req.body, password: hash });

    const savedUser = await newUser.save();
    if (!savedUser) return next(createError(404, "Cannot create user"));
    const accessToken = jwt.sign(
      {
        id: savedUser._id,
        role: savedUser.role,
        username: savedUser.username,
        balance:savedUser.balance
      },
      process.env.JWT_SEC,
      { expiresIn: "3h" }
    );

    const { password, ...others } = savedUser._doc;
    res.status(200).json({ ...others, accessToken });
  } catch (err) {
    next(err);
  }
};

export const signin = async (req, res, next) => {
  try {
    const user = await User.findOne({ username: req.body.username });
    if (!user) return next(createError(404, "User not found!"));

    const isCorrect = await bcrypt.compare(req.body.password, user.password);

    if (!isCorrect) return next(createError(400, "Wrong Credentials!"));

    const accessToken = jwt.sign(
      {
        id: user._id,
        role: user.role,
        username: user.username,
        balance: user.balance
      },
      process.env.JWT_SEC,
      { expiresIn: "3h" }
    );

    const { password, ...others } = user._doc;
    res.status(200).json({ ...others, accessToken });
  } catch (err) {
    next(err);
  }
};

export const revalidateAuth = async (req, res, next) => {
  let id = req.token.id;
  try {
    const user = await User.findOne({ _id: id });
    if (!user) return next(createError(404, "User not found!"));
    const { password, ...others } = user._doc;
    res.status(200).json(others);
  } catch (err) {
    next(err);
  }
};

export const updateUserPassword = async (req, res, next) => {
  let { oldPassword, newPassword } = req.body;
  let { id } = req.token;

  try {
    const user = await User.findById(id);
    if (!user) return next(createError(404, "User not found!"));

    const isCorrect = await bcrypt.compare(oldPassword, user.password);

    if (!isCorrect) return next(createError(400, "old password is wrong!"));

    const salt = bcrypt.genSaltSync(10);
    const hash = bcrypt.hashSync(newPassword, salt);

    user.password = hash;

    const savedUser = await user.save();
    const { password, ...others } = savedUser._doc;
    res.status(200).json({ ...others });
  } catch (err) {
    next(err);
  }
};

export const updateUser = async (req, res, next) => {
  let fieldsANDvalues = {};

  // Parse JSON data from 'data' if available
  if (req.body.data) {
    try {
      fieldsANDvalues = JSON.parse(req.body.data);
    } catch (error) {
      return next(new Error("Invalid JSON data")); // Early return on parsing error
    }
  }

  // Process the file if available and append its URL to the fieldsANDvalues object
  if (req.file) {
    try {
      const publicUrl = await uploadFile(req.file); // Assume uploadFile is a function that uploads the file and returns its public URL
      fieldsANDvalues.photoURL = publicUrl; // Update the photoURL field
    } catch (error) {
      return next(error); // Handle file upload error
    }
  }

  try {
    // Attempt to update the user with the fieldsANDvalues object
    const updatedUser = await User.findByIdAndUpdate(
      req.params.id,
      { $set: fieldsANDvalues },
      { new: true } // Options to return the document after update
    ).lean(); // Convert Mongoose document to a plain JavaScript object for efficiency

    if (!updatedUser) {
      return res.status(404).json({ message: "User not found" }); // Handle non-existent user
    }

    const { password, ...others } = updatedUser; // Exclude sensitive data
    res.status(200).json(others); // Respond with the updated user data, minus the password
  } catch (error) {
    next(error); // Handle any errors during user update
  }
};
export const createByAdmin = async (req, res, next) => {
  let fieldsANDvalues = {};

  // Parse JSON data from 'data' if available
  if (req.body.data) {
    try {
      const data = JSON.parse(req.body.data);
      const { password, ...others } = data;
      const salt = await bcrypt.genSalt(10); // Use async version
      const hash = await bcrypt.hash(password, salt); // Use async version
      fieldsANDvalues = { ...others, password: hash };
    } catch (error) {
      return next(new Error("Invalid JSON data")); // Early return on parsing error
    }
  }

  // Process the file if available and append its URL to the fieldsANDvalues object
  if (req.file) {
    try {
      const publicUrl = await uploadFile(req.file); // Correct assumption
      fieldsANDvalues.photoURL = publicUrl;
    } catch (error) {
      return next(error); // Handle file upload error
    }
  }

  try {
    const newUser = new User({ ...fieldsANDvalues });
    const savedUser = await newUser.save();

    if (!savedUser) {
      return res.status(404).json({ message: "cannot create user" });
    }

    const { password, ...others } = savedUser.toObject(); // Convert to plain object and exclude password
    res.status(200).json(others); // Respond with the updated user data, minus the password
  } catch (error) {
    next(error); // Handle any errors during user creation
  }
};

export const findAll = async (req, res, next) => {
  const userId = req.token.id;
  try {
    const users = await User.find({ _id: { $ne: userId } }).select(
      "_id firstname lastname email isAdmin"
    );
    if (!users) return next(createError(404, "No users!"));

    res.status(200).json(users);
  } catch (err) {
    next(err);
  }
};

export const getUserCount = async (req, res, next) => {
  let data;
  try {
    const users = await User.count();
    if (!users) return next(createError(404, "users not found!"));

    data = users;
    res.status(200).json(data);
  } catch (err) {
    next(err);
  }
};
export const getSimpleUserCount = async (req, res, next) => {
  let data;
  try {
    const users = await User.count({ isAdmin: false });
    if (!users) return next(createError(404, "users not found!"));

    data = users;
    res.status(200).json(data);
  } catch (err) {
    next(err);
  }
};
export const getAdminUserCount = async (req, res, next) => {
  let data;
  try {
    const users = await User.count({ isAdmin: true });
    if (!users) return next(createError(404, "users not found!"));

    data = users;
    res.status(200).json(data);
  } catch (err) {
    next(err);
  }
};

export const deleteUser = async (req, res, next) => {
  let hash = req.params.id;
  try {
    await User.findByIdAndDelete(hash);

    res.status(200).json("User Deleted Successfully !");
  } catch (err) {
    next(err);
  }
};
export const getUser = async (req, res, next) => {
  let id = req.params.id;
  try {
    const user = await User.findById(id);
    if (!user) return next(createError(404, "user not found!"));
    res.status(200).json(user);
  } catch (err) {
    next(err);
  }
};
