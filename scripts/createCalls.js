/*

Copyright 2020 Stefan Hintzen

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions.

*/

// setup necessary libraries.
let mysql = require('mysql');
let { dbConfig } = require('../globals')
let dbConnection;
const TYPE = 'GAUSSIAN';


/**
 *	Shuffles the order of elements in an array.
 *
 *	@param array: The array to shuffle.
 *	@returns the shuffled array.
 */
function shuffle(array) {
	
	var currentIndex = array.length, temporaryValue, randomIndex;

	// Shuffle elements a random amount of times.
	while (0 !== currentIndex) {
		
		randomIndex = Math.floor(Math.random() * currentIndex);
		currentIndex -= 1;

		temporaryValue = array[currentIndex];
		array[currentIndex] = array[randomIndex];
		array[randomIndex] = temporaryValue;
	}

	// Return the shuffled array.
	return array;
}


/**
 * Connects to the local MySQL/MariaDB database.
 */
function connectToDB()	{
	
	console.log('DB-Connection lost. Start Reconnecting');
	
	return new Promise(function(resolve, reject) {
		
		dbConnection = mysql.createConnection({
			host     : 	dbConfig.host,
			port     :  dbConfig.port,
			database :  dbConfig.database,
			user     :  dbConfig.user,
			password :  dbConfig.password,
			debug    :  dbConfig.debug,
			multipleStatements: dbConfig.multipleStatements
		});
		
		// Connect to the database.
		dbConnection.connect(function(err) {
		
			if (err)	{
				console.log(JSON.stringify(err));
				return reject(err);
			}
			console.log('Reconnecting done. DB-Connection established');
			return resolve(true);
		});
	});
}

/**
 *	Executes the provided query against the database.
 *
 *	@param q: The provided query as string.
 *	@returns the result as provided by the database.
 */
function queryDB(q)	{
	console.log(q);
	return new Promise(function(resolve, reject)	{
		dbConnection.query(q, function(err, data)	{
			if(err)	{
				return reject(err);
			}
			return resolve(data);
		});
	});
}

/**
 *	Generates calls from the values saved in the database. Requires a member called "gold", which indicates that a entry is more
 *	interesting than ither ones. A value for gold higher than 0 makes an entry interesting. 20% of all calls will get deducted from
 *	interesting entries and 80% from not interesting entries.
 *
 *	@param x: The amount of calls to generate as number.
 *	@param attr: The attribute whose values shall get gathered from entries to deduct the calls.
 *	@returns All generated calls as an array of strings.
 */
function generateCalls(x, attr)	{

	return new Promise(async function(resolve, reject)	{
		
		await connectToDB();
		
		const gold = Math.floor(x * 0.2);
		const rem = Math.floor(x * 0.8);
		
		// Select all entries and split them into interesting and not intereyting entries.
		var goldArray = await queryDB('SELECT * FROM u_loc_ncsu WHERE gold > 0;');
		var remArray = await queryDB('SELECT * FROM u_loc_ncsu WHERE gold = 0;');
		
		// Pick the entries to use for calls from not-interesting entries.
		let remSelection = [];
		for(let j=0; j < rem; j++)	{
			remSelection.push(remArray[Math.floor(Math.random() * remArray.length)]);
		}
		
		// Pick the entries to use for calls from interesting entries.
		let goldSelection = [];
		for(let j=0; j < gold; j++)	{
			goldSelection.push(goldArray[Math.floor(Math.random() * goldArray.length)]);
		}
		
		// Remove everything expect the needed attribute from the entries.
		let allEntries = goldSelection.concat(remSelection).map((el) => {
			return el[attr];
		});
		allEntries = shuffle(allEntries);

		// Deduct the call from every entry.
		let allCalls = allEntries.map((el,ind) => {
			
			// Extensive completeness.
			if(TYPE !== 'GAUSSIAN')	{
				let point = Math.random();
				let c = 0.5;
				
				el = el + '*';
				while(2 < el.length && point < c)	{
					el.replace('*','').replace(/.$/,'*');
					c = c / 2; 
				}
			}
			// Normal completeness.
			else	{
				const normalRand = function() {
					var u = 0, v = 0;
					while(u === 0) {
						u = Math.random();
					}
					while(v === 0) {
						v = Math.random();
					}
					let num = Math.sqrt( -2.0 * Math.log( u ) ) * Math.cos( 2.0 * Math.PI * v );
					num = num / 10.0 + 0.5;
					if (num > 1 || num < 0) {	
						return normal_rand();
					}
					return num;
				}
				
				const point = normalRand();
				const divider = Math.floor(point / (1 / el.length)) + 1
				if(divider < el.length)	{
					el = el.substring(0, divider) + '*';
				}
			}
			
			return el;
		});
		
		return resolve(allCalls);
	});
}

// Start the generation.
async function cont()	{
	const CALLS = 100;
	let calls = await generateCalls(CALLS);
	console.log(calls);
}
cont();