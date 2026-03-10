import express from 'express';
import dotenv from 'dotenv';
import mongoDB from './db/mongoose.js';
import { AuthRouter } from './routes/auth.route.js';
import fileUpload from 'express-fileupload';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import http from 'http';
import { Server } from 'socket.io';

dotenv.config();

const app = express();
const server = http.createServer(app);
export const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  }
});

const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(cors({ origin: '*', methods: ['GET', 'POST', 'PUT', 'DELETE'] }));
app.use(fileUpload({ useTempFiles: true, tempFileDir: '/tmp/' }));
app.use(cookieParser());

mongoDB();

app.use('/auth', AuthRouter);

app.get('/', (req, res) => {
  res.send("API is running...");
});

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);
  
  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);
  });
});

server.listen(2224, "0.0.0.0", () => {
  console.log("Server running at http://0.0.0.0:2224");
});
