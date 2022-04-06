const express = require('express');
const multer  = require('multer');
const upload = multer({ dest: 'Task files/' });
const fs = require('fs');
const cookieParser = require('cookie-parser');
const { path, use } = require('express/lib/application');
const jwt = require('jsonwebtoken');
const { Server } = require('socket.io');
const app = express();
const http = require('http');
const server = http.createServer(app);
const io = new Server(server);
const bcrypt = require('bcrypt');

const port = 80;
const jwtKey = 'mysecretkey';
const jwtExpirySeconds = 300;


app.use('/', express.static('html'));
app.use('/', express.static('css'));
app.use('/', express.static('js'));
app.use('/', express.static('svg'));

app.get('/socket.io.js', (req, res) => {
  res.sendFile(__dirname + 'node_modules/socket.io/client-dist/socket.io.js');
});


io.on('connection', (socket) => {
  console.log('a user connected');

  socket.on('disconnect', () => {
    console.log('user disconnected');
  });
});


let statuses;

function loadStatuses() {
  statuses = JSON.parse(fs.readFileSync('taskStatuses.json'));
}

loadStatuses();


app.use(cookieParser());


app.post('/signup', upload.none(), (req, res) => {
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
});


app.post('/login', upload.none(), (req, res) => {
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
});


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


app.get('/statuses', checkAuth, (req, res) => {
  res.send(statuses);
})


app.get('/tasks', checkAuth, (req, res) => {
  const rawTasks = fs.readFileSync('tasks.json');
  let tasks = JSON.parse(rawTasks);

  let filter = req.query.filter;

  if (filter)
  {
    filter = Number(filter);
    tasks = tasks.filter(task => task.statusId === filter);
  }

  res.send(tasks);
})


app.get('/tasks/:id/file', checkAuth, (req, res) => {
  const rawTasks = fs.readFileSync('tasks.json');
  const tasks = JSON.parse(rawTasks);
  
  const taskId = Number(req.params.id);

  const task = tasks.find(t => t.id === taskId);

  res.download(`${__dirname}/Task files/${taskId}.bin`, task.file);
})


app.put('/tasks/:id/update', checkAuth, upload.single('file'), (req, res) => {
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
})


app.post('/tasks/add', checkAuth, upload.single('file'), (req, res) => {
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
})


app.delete('/tasks/:id/delete', checkAuth, (req, res) => {
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
})


server.listen(port, () => {
  console.log(`Listening on port ${port}`);
});