import mongoose from "mongoose";


export const MongoDbConnection = () => {
  mongoose
    .connect(process.env.MONGOLOCAL, {
    //   useNewUrlParser: true,
    //   useUnifiedTopology: true,
    })
    .then(() => console.log("Connected successfully to MongoDB"))
    .catch((err) => console.error("Connection to MongoDB failed", err));
};