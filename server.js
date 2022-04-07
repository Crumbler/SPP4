const express = require('express');
const multer  = require('multer');
const upload = multer({ dest: 'Task files/' });
const fs = require('fs');
const { path, use } = require('express/lib/application');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const cookie = require('cookie');
const { Server } = require('socket.io');
const app = express();
const http = require('http');
const server = http.createServer(app);
let io;
const bcrypt = require('bcrypt');

const port = 80;
const jwtKey = 'mysecretkey';
const jwtExpirySeconds = 300;

let statuses;

function loadStatuses() {
  statuses = JSON.parse(fs.readFileSync('taskStatuses.json'));
}


loadStatuses();


app.use('/', express.static('html'));
app.use('/', express.static('css'));
app.use('/', express.static('js'));
app.use('/', express.static('svg'));


app.get('/socket.io.js', (req, res) => {
  res.sendFile(__dirname + '/node_modules/socket.io/client-dist/socket.io.js');
});

app.get('/FileSaver.js', (req, res) => {
  res.sendFile(__dirname + '/node_modules/file-saver/dist/FileSaver.min.js');
});


app.use(cookieParser());

app.post('/signup', upload.none(), onSignup);
app.post('/login', upload.none(), onLogin);

app.use(checkAuth);

io = new Server(server, {
  allowRequest: checkHandshake,
  maxHttpBufferSize: 10e6 // 10 MB
});


function checkHandshake(req, callback) {
  if (!req.headers.cookie) {
    console.log('Authentication rejected due to lack of token');
    return callback(null, false);
  }

  const cookies = cookie.parse(req.headers.cookie);

  const token = cookies.token;

  if (!token) {
    console.log('Authentication rejected due to lack of token');
    return callback(null, false);
  }

  try {
		jwt.verify(token, jwtKey);
	} catch (err) {
		if (err instanceof jwt.JsonWebTokenError) {
			// Unauthorized JWT
      console.log('Unauthorized JWT');
			return callback(null, false);
		}
		// Otherwise, bad request
    console.log('Bad request');
		return callback(null, false);
	}

  callback(null, true);
}


io.on('connection', onConnection);


function onSignup(req, res) {
  let { username, password } = req.body;

  const rawUsers = fs.readFileSync('users.json');
  let users = JSON.parse(rawUsers);

  password = bcrypt.hashSync(password, 10);

  let newId = 1;

  if (users.length > 0) {
    newId = users[users.length - 1].id + 1;
  }

  const user = { 
    id: newId,
    username,
    password
  };

  users.push(user);

  const token = jwt.sign({
    username,
    id: user.id
  }, jwtKey, {
    expiresIn: jwtExpirySeconds
  });

  res.cookie('token', token, {
    httpOnly: true,
    maxAge: jwtExpirySeconds * 1000
  });

  const writeData = JSON.stringify(users, null, 2);
  fs.writeFileSync('users.json', writeData);

  console.log('Successful signup and login');

  res.status(200).end();
}


function onLogin(req, res) {
  const { username, password } = req.body;

  const rawUsers = fs.readFileSync('users.json');

  const users = JSON.parse(rawUsers);

  const user = users.find(u => u.username === username);

  if (!user || !(bcrypt.compareSync(password, user.password))) {
    console.log('Failed to log in');
    return res.status(401).end();
  }

  const token = jwt.sign({
    username,
    id: user.id
  }, jwtKey, {
    expiresIn: jwtExpirySeconds
  });

  res.cookie('token', token, {
    httpOnly: true,
    maxAge: jwtExpirySeconds * 1000
  });

  console.log('Successful login');

  res.status(200).end();
}


function checkAuth(req, res, next) {
  if (!req.cookies.token) {
    return res.status(401).end();
  }

  const token = req.cookies.token;

  try {
		jwt.verify(token, jwtKey);
	} catch (err) {
		if (err instanceof jwt.JsonWebTokenError) {
			// Unauthorized JWT
      console.log('Unauthorized JWT');
			return res.status(401).end();
		}
		// Otherwise, bad request
    console.log('Bad request');
		return res.status(400).end();
	}

  next();
}


function onConnection(socket) {
  console.log('User connected');

  socket.on('disconnect', () => {
    console.log('User disconnected');
  });

  socket.on('statuses', onGetStatuses);

  socket.on('tasks', onGetTasks);

  socket.on('update', onUpdateTask);

  socket.on('file', onGetTaskFile);

  socket.on('add', onTaskAdd);

  socket.on('delete', onTaskDelete);

  socket.on('error', onError);
}


function onGetStatuses(callback) {
  callback(statuses);
}


function onGetTasks(filter, callback) {
  const rawTasks = fs.readFileSync('tasks.json');
  let tasks = JSON.parse(rawTasks);

  if (filter != null)
  {
    filter = Number(filter);
    tasks = tasks.filter(task => task.statusId === filter);
  }

  callback(tasks);
}

function onError(err) {
  if (err) {
    console.log('Error: ' + err);
  }
}


function onGetTaskFile(taskId, callback) {
  const rawTasks = fs.readFileSync('tasks.json');
  const tasks = JSON.parse(rawTasks);

  const task = tasks.find(t => t.id === taskId);

  const rawFile = fs.readFileSync(`Task files/${taskId}.bin`);

  callback(rawFile);
}


function onUpdateTask(receivedTask, file) {
  const rawTasks = fs.readFileSync('tasks.json');
  const tasks = JSON.parse(rawTasks);

  console.log('Received task ' + receivedTask.title);
  
  const taskId = receivedTask.id;
  
  const task = tasks.find(t => t.id === taskId);

  if (receivedTask.title != null) {
    task.title = receivedTask.title;
  }

  if (receivedTask.statusid != null) {
    task.statusId = receivedTask.statusid;
  }

  if (receivedTask.date) {
    task.completionDate = receivedTask.date;
  }
  else {
    task.completionDate = null;
  }

  if (file != null) {
    fs.writeFileSync(`Task files/${taskId}.bin`, file);
    task.file = receivedTask.file;
  }
  else {
    try {
      fs.unlinkSync(`Task files/${taskId}.bin`);
    } catch(err) {
      // file didn't exist
    }

    task.file = null;
  }
  
  const writeData = JSON.stringify(tasks, null, 2);
  fs.writeFileSync('tasks.json', writeData);
}


function onTaskAdd(receivedTask, file, callback) {
  const rawTasks = fs.readFileSync('tasks.json');
  const tasks = JSON.parse(rawTasks);
  
  const taskId = tasks[tasks.length - 1].id + 1;
  
  const task = { 
    id: taskId,
    title: receivedTask.title ?? 'New task',
    statusId: Number(receivedTask.statusid ?? '0'),
    completionDate: receivedTask.completionDate
  };

  if (!receivedTask.date) {
    task.completionDate = null;
  }

  if (file) {
    fs.writeFileSync(`Task files/${taskId}.bin`, file);
    task.file = receivedTask.file;
  }
  else {
    task.file = null;
  }

  tasks.push(task);

  const writeData = JSON.stringify(tasks, null, 2);
  fs.writeFileSync('tasks.json', writeData);

  callback(taskId);
}


function onTaskDelete(taskId) {
  const rawTasks = fs.readFileSync('tasks.json');
  let tasks = JSON.parse(rawTasks);

  const taskInd = tasks.findIndex(task => task.id === taskId);
  
  tasks.splice(taskInd, 1);
  tasks = tasks.filter(e => e != null);

  try {
    fs.unlinkSync(`Task files/${taskId}.bin`);
  } catch(err) {
    // file didn't exist
  }

  const writeData = JSON.stringify(tasks, null, 2);
  fs.writeFileSync('tasks.json', writeData);
}


server.listen(port, () => {
  console.log(`Listening on port ${port}`);
});