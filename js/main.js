'use strict'

const modalTask = $('.modal-task')[0],
      modalTaskForm = $('.modal-task .modal-content')[0],
      modalLogin = $('.modal-login')[0],
      modalLoginForm = $('.modal-login .modal-content')[0];

let statuses, tasks, currentTask,
    currentTaskElement;

let addingTask = false;

let socket = io({
    reconnection: false,
    autoConnect: false
});


window.onload = onWindowLoad;

$('header > form').submit(onFilter);
$('.modal-task .modal-content').submit(onModalTaskSubmit);
$('.modal-task .modal-content .button-close').click(onModalTaskClose);
$('.modal-login .modal-content').submit(onModalLoginSubmit);
$('.modal-login .modal-content .button-signup').click(onModalLoginSignUp);
$('.task-add-button').click(onAddClick);


function onWindowLoad() {
    clearTasks();
    
    promptLogin();

    socket.on('connect', onConnect);
    socket.on('connect_error', onConnectError);

    socket.connect();
}


function clearTasks() {
    $('.task').remove();
}


function emitAsync(...args) {
    return new Promise((resolve, reject) => {
        socket.emit(...args, res => resolve(res));
    });
}


async function onConnect() {
    console.log('Connected');

    clearTasks();

    hideModalLogin();

    await getStatuses();
    getTasks()
}


function onConnectError(err) {
    promptLogin();
    console.log('Connect error: ' + err.message);
}


async function getStatuses() {
    if (!socket.connected) {
        promptLogin();
        return;
    }

    statuses = await emitAsync('statuses');

    let statusOptions = statuses.map(createStatusOption);

    $('.modal #task-status > *').remove();
    $('.modal #task-status').append(...statusOptions);

    statusOptions = [ 'None' ].concat(statuses).map(createStatusOption);

    $('#filter-type > *').remove();
    $('#filter-type').append(...statusOptions);
}


function promptLogin() {
    resetModalLoginForm();

    showModalLogin();
}


function createStatusOption(status) {
    const el = document.createElement('option');
    el.textContent = status;

    return el;
}


async function getTasks(status) {
    if (!socket.connected) {
        socket.connect();
        return;
    }

    tasks = await emitAsync('tasks', status);

    const taskElements = tasks.map(task => createTaskElement(task));

    $('main').append(...taskElements);
}


function getTaskHTML(task) {
    const mainPart = `${task.title}: ${statuses[task.statusId]}<br>
                      Completion date: ${task.completionDate ?? 'None'}<br>
                      File: `;

    let filePart = 'None';

    if (task.file) {
        filePart = `<a href="/tasks/${task.id}/file">${task.file}</a>`;
    }

    return mainPart + filePart;
}


function createTaskElement(task) {
    const taskContent = document.createElement('div');
    taskContent.className = 'task-content';
    taskContent.innerHTML = getTaskHTML(task);

    const icon1 = document.createElement('icon');
    icon1.className = 'icon icon-edit';

    const buttonEdit = document.createElement('button');
    buttonEdit.className = 'task-button';
    buttonEdit.append(icon1);
    buttonEdit.onclick = onEditClick;

    const icon2 = document.createElement('icon');
    icon2.className = 'icon icon-delete';

    const buttonDelete = document.createElement('button');
    buttonDelete.className = 'task-button';
    buttonDelete.append(icon2);
    buttonDelete.onclick = onDeleteClick;

    const taskDropdown = document.createElement('div');
    taskDropdown.className = 'task-dropdown';
    taskDropdown.append(buttonEdit, buttonDelete);

    const taskElement = document.createElement('div');
    taskElement.className = 'task';
    taskElement.task = task;
    taskElement.append(taskContent, taskDropdown);

    return taskElement;
}


function onFilter(event) {
    event.preventDefault();

    clearTasks();

    const selectedVal = document.getElementById('filter-type').selectedIndex;
    
    if (selectedVal >= 1 && selectedVal <= statuses.length) {
        getTasks(selectedVal - 1);
    }
    else {
        getTasks();
    }
}


function onModalLoginSignUp() {
    const formData = new FormData(this.parentNode);

    LogSign('/signup', formData);
}


function onModalLoginSubmit(event) {
    event.preventDefault();

    const formData = new FormData(this);

    LogSign('/login', formData);
}


async function LogSign(urlpath, formData) {
    const response = await fetch(urlpath, {
        method: 'POST',
        body: formData
    });

    if (response.ok) {
        socket.connect();
    }
    else {
        resetModalLoginForm();
        alert('Invalid credentials');
    }
}


function resetModalTaskForm() {
    modalTaskForm.reset();
}


function resetModalLoginForm() {
    modalLoginForm.reset();
}


function hideModalTask() {
    modalTask.style.display = 'none';
}


function hideModalLogin() {
    modalLogin.style.display = 'none';
}


function showModalTask() {
    modalTask.style.display = 'block';

    $('.modal-task .modal-content .button-submit')[0].value = addingTask ? 'Add' : 'Update';
}


function showModalLogin() {
    modalLogin.style.display = 'block';
}


function onEditClick(event) {
    currentTaskElement = this.parentNode.parentNode;

    currentTask = currentTaskElement.task;

    resetModalTaskForm();

    addingTask = false;

    showModalTask();
}


async function onDeleteClick(event) {
    currentTaskElement = this.parentNode.parentNode;

    currentTask = currentTaskElement.task;

    const fetchURL = `/tasks/${currentTask.id}/delete`;

    const response = await fetch(fetchURL, {
        method: 'DELETE'
    });

    if (response.ok) {
        const taskInd = tasks.findIndex(task => task === currentTask);
        tasks.splice(taskInd, 1);
        tasks = tasks.filter(t => t != null);

        currentTaskElement.remove();
    }
}


function onModalTaskSubmit(event) {
    event.preventDefault();

    const formData = new FormData(this);

    if (!formData.has('date')) {
        formData.set('date', null);
    }

    if (!formData.has('file')) {
        formData.set('file', null);
    }

    const statusId = $('#task-status')[0].selectedIndex;

    formData.set('statusid', statusId);
    
    if (addingTask) {
        addTask(formData);
    }
    else {
        updateTask(formData);
    }

    hideModalTask();
}


async function addTask(formData) {
    const response = await fetch(`/tasks/add`, {
        method: 'POST',
        body: formData
    });

    const result = await response.text();

    const taskId = Number(result);

    if (response.ok) {
        const task = { }

        task.title = formData.get('name');
        task.statusId = Number(formData.get('statusid'));
        task.completionDate = formData.get('date');
        task.id = taskId;

        const taskFile = formData.get('file');

        task.file = taskFile.name;

        if (!task.completionDate) {
            task.completionDate = null;
        }

        if (!task.file) {
            task.file = null;
        }

        $('main').append(createTaskElement(task));
    }
}


async function updateTask(formData) {
    const response = await fetch(`/tasks/${currentTask.id}/update`, {
        method: 'PUT',
        body: formData
    });

    if (response.ok) {
        currentTask.title = formData.get('name');
        currentTask.statusId = Number(formData.get('statusid'));
        currentTask.completionDate = formData.get('date');

        const taskFile = formData.get('file');

        currentTask.file = taskFile.name;

        if (!currentTask.completionDate) {
            currentTask.completionDate = null;
        }

        if (!currentTask.file) {
            currentTask.file = null;
        }

        currentTaskElement.firstChild.innerHTML = getTaskHTML(currentTask);
    }
}


function onModalTaskClose(event) {
    hideModalTask();
}


function onAddClick(event) {
    addingTask = true;

    resetModalTaskForm();

    showModalTask();
}