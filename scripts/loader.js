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


var mysql;
var dbConnection;

/**
 *	Parses an csv-file as string into a string array containing one line in one index.
 *
 * @note created and copyright by Ben Nadel (https://www.bennadel.com/blog/1504-ask-ben-parsing-csv-strings-with-javascript-exec-regular-expression-command.htm)
 */
function CSVToArray (CSV_string, delimiter) {
   delimiter = (delimiter || ","); // user-supplied delimeter or default comma

	console.log(delimiter);
   var pattern = new RegExp( // regular expression to parse the CSV values.
     ( // Delimiters:
       "(\\" + delimiter + "|\\r?\\n|\\r|^)" +
       // Quoted fields.
       "(?:\"([^\"]*(?:\"\"[^\"]*)*)\"|" +
       // Standard fields.
       "([^\"\\" + delimiter + "\\r\\n]*))"
     ), "gi"
   );

   var rows = [[]];  // array to hold our data. First row is column headers.
   // array to hold our individual pattern matching groups:
   var matches = false; // false if we don't find any matches
   // Loop until we no longer find a regular expression match
   while (matches = pattern.exec( CSV_string )) {
       var matched_delimiter = matches[1]; // Get the matched delimiter
       // Check if the delimiter has a length (and is not the start of string)
       // and if it matches field delimiter. If not, it is a row delimiter.
       if (matched_delimiter.length && matched_delimiter !== delimiter) {
         // Since this is a new row of data, add an empty row to the array.
         rows.push( [] );
       }
       var matched_value;
       // Once we have eliminated the delimiter, check to see
       // what kind of value was captured (quoted or unquoted):
       if (matches[2]) { // found quoted value. unescape any double quotes.
        matched_value = matches[2].replace(
          new RegExp( "\"\"", "g" ), "\""
        );
       } else { // found a non-quoted value
         matched_value = matches[3];
       }
       // Now that we have our value string, let's add
       // it to the data array.
       rows[rows.length - 1].push(matched_value);
   }
   return rows; // Return the parsed data Array
}


/**
 * Connects to the local MySQL/MariaDB database.
 */
function connectToDB()	{
	
	console.log('DB-Connection lost. Start Reconnecting');
	
	return new Promise(function(resolve, reject) {
		
		mysql = mysql ? mysql : require('mysql');
		dbConnection = mysql.createConnection({
			host     : '127.0.0.1',
			port     :  3306,
			database : 'scdm',
			user     : 'root',
			password : 'rootroot',
			debug    :  false,
			multipleStatements: true
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
 *	Loads the artifical database NAMES.
 *	
 *	@param size: the amount of different entries from the root dataset from which the artificial
 *				dataset shall get deducted.
 *	@returns the created entries as array.
 */
function loadDB(size)	{
	
	return new Promise(function(resolve,reject)	{
		
		const fs = require('fs');
		
		// Reads the data from the provided csv-file.
		fs.readFile('../names.csv', 'utf8', async function(err, data) {
			
			if (err) throw err;

			// Remove csv meta data and split into array of lines.
			data = data.substring(0, data.length - 2).split('\r\n');
			
			// Limits the entries to the specified count.
			if(size)	{
				data = data.slice(0,size);
			}
			
			data = data.map(function(el)	{
				var datas = el.split(';');
				return {
					name: datas[0].toLowerCase(),
					count: parseInt(datas[1])
				};
			});
			
			var newDB = [];
			
			/* Create each value as often as specified by its occurance and add it to the database array. Hereby, the count gets scaled
			by a common factor which is chosen so that the least often occuring name exists exactly once in the database.*/ 
			data.forEach(function(el)	{
				var newEntries = new Array(Math.ceil(el.count / data[data.length - 1].count)).fill(el.name);
				newDB = newDB.concat(newEntries); 
			});
			
			// Adds a unique index to each entry.
			var indexer = 0;
			newDB = newDB.sort().map(function(el)	{
				var newEl = {
					sn: {
						index: indexer.toString(),
						val: el
					}
				};
				indexer++;
				return newEl;
			});
			
			console.log('DB length: ' + newDB.length);
			console.log('most (1st): ' + data[0].name + ', ' + Math.ceil(data[0].count / data[data.length - 1].count));
			console.log('most (2nd): ' + data[1].name + ', ' + Math.ceil(data[1].count / data[data.length - 1].count));
			console.log('most (3rd): ' + data[2].name + ', ' + Math.ceil(data[2].count / data[data.length - 1].count));
			console.log('least (3rd): ' + data[data.length - 3].name + ', ' + Math.ceil(data[data.length - 3].count / data[data.length - 1].count));
			console.log('least (2nd): ' + data[data.length - 2].name + ', ' + Math.ceil(data[data.length - 2].count / data[data.length - 1].count));
			console.log('least (1st): ' + data[data.length - 1].name + ', ' + Math.ceil(data[data.length - 1].count / data[data.length - 1].count));
			console.log('average count per name: ' + newDB.length / data.length);
			
			// Write all created entries into the foreign API mock'S database.
			await connectToDB();
			let insertQuery = 'INSERT INTO hd_mock_names(uid, sn) VALUES'
			for(var i=0; i < newDB.length; i++)	{
				insertQuery += '(' + newDB[i].sn.index + ',' + mysql.escape(newDB[i].sn.val) + '),';
			}
			insertQuery = insertQuery.replace(/,$/,';');
			dbConnection.query(insertQuery, function(err)	{
				dbConnection.end();
				if(err)	{
					reject(err);
				}
				return resolve(newDB);
			});
		});
	});
}

/**
 *	Loads the real dataset LANDSLIDES. The dataset got modifed so that ® is the dividing character for the csv.
 *
 *	@returns the created data entries in an array.
 */
function loadRealDB()	{
	
	return new Promise(function(resolve,reject)	{
		
		// The attributes to load for each entry.
		const TRACK = ['event_id', 'event_title', 'source_name', 'event_date', 'country_name', 
				'landslide_setting'];
		const fs = require('fs');
		
		// Load the dataset LANDSLIDES.
		fs.readFile('../landslides.csv', 'utf-8', async function(err, data) {
			
			if (err) throw err;
			
			// Remove metadata.
			data = data.substring(0, data.length - 2).trim();
			// Divide the csv into an array with the delimiter ®.
			data = CSVToArray(data, '®');
			let T_MAP = {};
			// Limits the enries to the attributes specified in TRACKS.
			TRACK.forEach((elA) => {
				T_MAP[elA] = data[0].findIndex((elB) => {
					return elA === elB;
				});
			});
			
			// remove the header line and encode special characters.
			data = data.slice(1).map(function(el)	{
				var res = {};
				TRACK.forEach((t) => {
					res[t] = encodeURI(el[T_MAP[t]]).toLowerCase();
				});
				return res;
			});
			
			await connectToDB();
			
			/* Insert the entries into the database of teh foreign API mock. Hereby, each value gets inserted as string, except for the date
			in the attribute "event_time".*/
			console.log('start insert');
			let insertQuery = 'INSERT INTO hd_mock_landslides(' + TRACK.join(',') + ') VALUES'
			for(var i=0; i < data.length; i++)	{
				insertQuery += '(';
				TRACK.forEach((el) => {
					let noDate = false;
					let d = data[i][el];
					// Special behaviour for "event_date", since we want to preserve this value as date.
					if(el === 'event_date')	{
						d = d.substring(0,10);
						d = d.split('/').join('-');
						if(d.indexOf('-') === -1)	{
							d = d.split('.').join('-');
							if(d.indexOf('-') === -1)	{
								d = null;
							}
						}
						else	{
							d = d.split('-');
							d = d[1] + '-' + d[0] + '-' + d[2];
						}
						insertQuery += 'str_to_date(' + mysql.escape(d) + ", '%d-%m-%Y'),";
					}
					else	{
						insertQuery += mysql.escape(d) + ',';
					}
				});
				insertQuery = insertQuery.replace(/,$/,'),');
			}
			// Insert the entries.
			insertQuery = insertQuery.replace(/,$/,';');
			dbConnection.query(insertQuery, function(err)	{
				
				console.log('insert done');
				if(err)	{
					reject(err);
				}
				return resolve(data);
			});
		});
	});
}

exports.loadRealDB = loadRealDB;
exports.loadDB = loadDB;