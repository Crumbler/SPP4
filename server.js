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
const res = require('express/lib/response');

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
  res.sendFile(__dirname + 'node_modules/socket.io/client-dist/socket.io.js');
});

app.use(cookieParser());

app.post('/signup', upload.none(), onSignup);
app.post('/login', upload.none(), onLogin);

app.use(checkAuth);

app.get('/tasks/:id/file', onGetTaskFile);
app.put('/tasks/:id/update', upload.single('file'), onUpdateTask);
app.post('/tasks/add', upload.single('file'), onTaskAdd);
app.delete('/tasks/:id/delete', onTaskDelete);

io = new Server(server, {
  allowRequest: checkHandshake
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


function onGetTaskFile(req, res) {
  const rawTasks = fs.readFileSync('tasks.json');
  const tasks = JSON.parse(rawTasks);
  
  const taskId = Number(req.params.id);

  const task = tasks.find(t => t.id === taskId);

  res.download(`${__dirname}/Task files/${taskId}.bin`, task.file);
}


function onUpdateTask(req, res) {
  if (!req.body) {
    return res.sendStatus(400);
  }

  const rawTasks = fs.readFileSync('tasks.json');
  const tasks = JSON.parse(rawTasks);
  
  const taskId = Number(req.params.id);
  
  const task = tasks.find(t => t.id === taskId);

  if (req.body.name != null) {
    task.title = req.body.name;
  }

  if (req.body.statusid != null) {
    task.statusId = Number(req.body.statusid);
  }

  if (req.body.date) {
    task.completionDate = req.body.date;
  }
  else {
    task.completionDate = null;
  }

  if (req.file) {
    fs.renameSync(`Task files/${req.file.filename}`, `Task files/${taskId}.bin`);
    task.file = req.file.originalname;
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

  res.sendStatus(200);
}


function onTaskAdd(req, res) {
  if (!req.body) {
    return res.sendStatus(400);
  }

  const rawTasks = fs.readFileSync('tasks.json');
  const tasks = JSON.parse(rawTasks);
  
  const taskId = tasks[tasks.length - 1].id + 1;
  
  const task = { 
    id: taskId,
    title: req.body.name ?? 'New task',
    statusId: Number(req.body.statusid ?? '0'),
    completionDate: req.body.date
  };

  if (!req.body.date) {
    task.completionDate = null;
  }

  if (req.file) {
    fs.renameSync('Task files/' + req.file.filename, 'Task files/' + taskId + '.bin');
    task.file = req.file.originalname;
  }
  else {
    try {
      fs.unlinkSync('Task files/' + taskId + '.bin');
    } catch(err) {
      // file didn't exist
    }

    task.file = null;
  }

  tasks.push(task);

  const writeData = JSON.stringify(tasks, null, 2);
  fs.writeFileSync('tasks.json', writeData);

  res.status(200).send(String(taskId));
}


function onTaskDelete(req, res) {
  const rawTasks = fs.readFileSync('tasks.json');
  let tasks = JSON.parse(rawTasks);

  const taskId = Number(req.params.id);

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

  res.sendStatus(200);
}


server.listen(port, () => {
  console.log(`Listening on port ${port}`);
});