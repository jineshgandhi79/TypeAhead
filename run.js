const { spawn } = require('child_process');
const path = require('path');

console.log('================================================================');
console.log('         🚀 STARTING SEARCH TYPEAHEAD APPLICATION 🚀           ');
console.log('================================================================');
console.log('');
console.log('Checking Docker environment and spinning up all services...');
console.log('This will build and run:');
console.log(' - MongoDB (Primary Store on port 27017)');
console.log(' - 3 Redis Cache Nodes (consistent hashing on ports 6379, 6380, 6381)');
console.log(' - Express Backend (APIs & Batch Writer on port 5000)');
console.log(' - React Frontend (Search UI & Visualizer on port 3000)');
console.log('');
console.log('Please stand by, this might take a minute on first build...');
console.log('----------------------------------------------------------------');

// Run docker-compose up --build
const dockerCompose = spawn('docker-compose', ['up', '--build'], {
  stdio: 'inherit',
  shell: true,
  cwd: __dirname
});

dockerCompose.on('close', (code) => {
  if (code !== 0) {
    console.error(`docker-compose exited with code ${code}. Please make sure Docker Desktop is running!`);
  } else {
    console.log('docker-compose stopped successfully.');
  }
});
