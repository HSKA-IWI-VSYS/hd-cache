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



//return (function() {

	//   ---------------------------------
	//   +++++  EVALUATION COUNTERS  +++++
	//   ---------------------------------
	//
	//	Collect different metrics about the execution.
	//
	
	let FOREIGN_API_CALLS = 0;
	let VOLUME_CONSISTANT_CALLS = 0;
	let VOLUME_INCONSISTANT_CALLS = 0;
	let U_LOC_CALLS = 0;
	let ITERATIONS = 0;
	let TIME_TOTAL = 0;
	let LODIS_ENTRIES = 0;
	let TIME_PAUSE = 0;
	let TIME_RESPONSE_TIME = 0;
	
	//   --------------------------------	
	//   +++++   GLOBAL VARIABLES   +++++
	//   --------------------------------	
	//
	//	Global attributes for the lambda container. Persist after lambda execution,
	//	will get reused if the lambda container is reused.


	// Address of the North Carolina State University (NCSU) LDAP directory, student branch
	const foreignApi = {
		url: 'ldap://ldap.ncsu.edu:389',
		dn: 'ou=students,ou=people,dc=ncsu,dc=edu'
	};
	// Decides if to use cloudWatch (false) or console.log (true)
	const LOG_INTO_CONSOLE = true;
	
	// Global variables, mainly imported modules.
	let mysql2;
	let dbConnection2;
	let ldap;
	let ldapConnection;
	let lambda;
	let con;
	let crypto;
	let logs;
	let logStreamName;
	let logSequenceToken;
	
	// Artificial break between LDAP-Calls in seconds.
	const pauseTime = 3;
	
	// Decides if the evaluation is run against a local hidden database mock or the foreign API NCSU.
	let LOCAL = true;
	// The tag of the database table set to use.
	let MOCK_NAME = 'names';
	
	// An attribute enforcing unique values on all entries (= v_unique)
	let UNIQUE_IDENTIFICATOR = MOCK_NAME !== 'landslides' ? 'uid' : 'event_id';
	let MOCK_NAME_HD = MOCK_NAME;
	
	// The complete domain alphabet of each crawlable attribute.
	const ALPHABET_MAP = [];
	ALPHABET_MAP['uid'] = '0123456789abcdefghijklmnopqrstuvwxyz'.split('').sort().join('');
	ALPHABET_MAP['sn'] = ' \'-abcdefghijklmnopqrstuvwxyz'.split('').sort().join('');
	
	ALPHABET_MAP['event_id'] = ',0123456789'.split('').sort().join('');
	ALPHABET_MAP['event_title'] = '#%&\'()*+,-./0123456789:;?@abcdefghijklmnopqrstuvwxyz~'.split('').sort().join('');
	ALPHABET_MAP['source_name'] = '!%&\'(),-./0123456789:@abcdefghijklmnopqrstuvwxyz_~'.split('').sort().join('');
	ALPHABET_MAP['event_date'] = '%./0123456789:amp'.split('').sort().join('');
	ALPHABET_MAP['country_name'] = '%.025abcdefghijklmnoprstuvwxyz'.split('').sort().join('');
	ALPHABET_MAP['landslide_setting'] = 'abcdefghiklmnoprstuvw_'.split('').sort().join('');
	
	
	
	// The known attributes present in entries.
	let attributes = MOCK_NAME !== 'landslides' ? ['uid', 'sn'] : ['event_id', 'event_title', 'source_name', 'event_date', 'country_name', 'landslide_setting'];
	
	
	
	//	 --------------------------------
	//   +++++   HELPER FUNCTIONS   +++++
	//	 --------------------------------
	//
	//	General helper functions used throughout the system

	/**
	 *	Creates a range filter conform to LDAP-syntax exclusively with the usage of begin-with-, equal and not-equal-filters.
	*
	*	@param field: A string specifing the attribute, on which the range filter should get applied.
	*	@param greaterFilterValue: The lower bound of the filter. A leading star-character (*) indates to use of greater-or-equal-syntax the range.
	*							   Otherwise, exclusive greater-than will get calculated for the value.
	*	@param smallerFilterFilter: The upper bound of the filter. A leading star-character (*) indates to use of smaller-or-equal-syntax the range.
	*								Otherwise, exclusive smaller-than will get calculated for the value.
	*	@param schema (OPTIONAL): Determines the architecture of the build filter. Accepts string values as following:
	*								- AND: Only use AND-connections to build subranges.
	*								- OR: Only use OR-connections to build subranges.
	*								- MIXED1: Use OR-connections for the deepest range level, AND-connections for all other ones.
	*								- MIXED2: Use AND-connections for the deepest range level, OR-connections for all other ones.
	*								- MIXED3: Use OR-connections for the two deepest range level, AND-connections for all other ones.
	* 								- MIXED4: Use AND-connections for the two deepest range level, OR-connections for all other ones.
	*	@param levels (DEPRECATED): An array containing indexes, indicating which deepness levels should be included into the filter.
	*								Not used anywhere in the remaining code.
	*	@returns The created LDAP-filter as string.
	*/
	function createLdapRangeFilter(field, greaterFilterValue, smallerFilterValue, schema, levels)	{
		
		// Sets the alphabet according to the specified attribute.
		const ALPHABET = ALPHABET_MAP[field].split('');
		
		console.log('--- CREATE LDAP RANGE FILTER ---');
		console.log('From ' + (greaterFilterValue ? greaterFilterValue.toLowerCase() : '---') + ' to ' + (smallerFilterValue ? smallerFilterValue.toLowerCase() : '---') + ' on field ' + field);
		// Sets the not provided parameter.
		greaterFilterValue = greaterFilterValue ? greaterFilterValue.toLowerCase() : '';
		smallerFilterValue = smallerFilterValue ? smallerFilterValue.toLowerCase() : '';

		// Returns a search for every value if no search range is specified.
		if(greaterFilterValue === '' && smallerFilterValue === '')	{
			return '(' + field + '=*)';
		}
		
		// Replaces spaces at the end because LDAP would interpret them as styling instead of characters.
		if(/^\*.*[ ]+$/.test(greaterFilterValue))	{
			greaterFilterValue = greaterFilterValue.replace('*','').replace(/[ ]+$/g,'');
		}
		
		// Checks if some filters are supposed to also be equality filters.
		var greaterEqual = greaterFilterValue.charAt(0) === '*';
		var smallerEqual = smallerFilterValue.charAt(0) === '*';

		// Removes metadata for equality filter check.
		greaterFilterValue = greaterFilterValue.replace('*','');
		smallerFilterValue = smallerFilterValue.replace('*','');
		
		// Gets the length of the longest word. Will be the start index.
		var max = Math.max(smallerFilterValue.length, greaterFilterValue.length) - 1,
			query = '(|',
			firstCase = true,
			processedGreaterFilterOnce = false,
			cutExtension = false;

			const o_schema = schema;
			
		// Narrows the range down beginning from the last letter to the first letter. Filters get created for each index and are pasted together for the final result.
		for(let i = max ; 0 <= i && !cutExtension; i--)	{
			
			// Specifies if the last round is reached, because then the range has to be narrowed from start and end in the same statement.
			cutExtension = greaterFilterValue.length > 0 && smallerFilterValue.length > 0 && (i === 0 || greaterFilterValue.substring(0, i) === smallerFilterValue.substring(0, i));
			// Only creates an filter on this index when requested or no allowed levels are provided.
			if(!levels || levels.indexOf(i) !== -1)	{

				// Set values so that the specified schema gets used.
				if(o_schema === 'MIXED1')	{
					if(i < 1)	{
						schema = 'OR';
					}
					else	{
						schema = 'AND';
					}	
				}
				if(o_schema === 'MIXED2')	{
					if(i < 1)	{
						schema = 'AND';
					}
					else	{
						schema = 'OR';
					}	
				}
				if(o_schema === 'MIXED3')	{
					if(i < 2)	{
						schema = 'OR';
					}
					else	{
						schema = 'AND';
					}	
				}
				if(o_schema === 'MIXED4')	{
					if(i < 2)	{
						schema = 'AND';
					}
					else	{
						schema = 'OR';
					}	
				}
				
				// Creates a part-query to narrow down the range if a letter exists at the current index for the lower bound.
				if(i < greaterFilterValue.length && !cutExtension){
					
					let greaterCurrent = greaterFilterValue.charAt(i),
						greaterLetterIndex = ALPHABET.indexOf(greaterCurrent),
						greaterBase = greaterFilterValue.substring(0, i),
						greaterQueryPart = '';
					
					// Decides if to use an negative AND-chain from the start or an positive OR-chain from the end, depending on which needs less atomic filters combined.
					if(schema === 'AND' || schema !== 'OR' && ALPHABET.indexOf(greaterCurrent) + 1 <= ALPHABET.length / 2)	{
						
						/* --- NEGATIVE AND-CHAIN FOR LOWER BORDER ---
						* Example: "'bc' < attr" at index 1 with alphabet (a,b,c,...,y,z) --BECOMES--> &(attr=b*)(!(|(attr=b)(attr=ba*)(attr=bb*)(attr=bc))) 
						*/

						var oldJ = -1;
						let parameterCount = 0;
						
						// Goes through all letters and create a atomic filter for those who need to be included into the AND-chain.
						for(let j=0; j < greaterLetterIndex || (!firstCase && j === greaterLetterIndex); j++)	{
							// Removes possible structures from the specified range to reach the wished range.
							greaterQueryPart += '(' + field + '=' + (greaterBase + ALPHABET[j]) + '*)';
							oldJ = j;
							parameterCount++;
						}

						// Also removes the lower border from the filter if a strict greater-filter is required.
						if(!greaterEqual && firstCase)	{
							greaterQueryPart += '(' + field + '=' + (greaterBase + ALPHABET[oldJ + 1]) + ')';
							parameterCount++;
						}
						// Adds the pure base to the negative chain.
						if(greaterBase !== '')	{
							greaterQueryPart += '(' + field + '=' + greaterBase + ')';
							parameterCount++;
						}
						
						// Part-query to allow all in subrange. The previous additions narrow this range down.
						greaterQueryPart = '(&(' + field + '=' + greaterBase + '*)(!' + (parameterCount > 1 ? '(|' : '') + greaterQueryPart + (parameterCount > 1 ? ')' : '') + '))';
					}
					else	{
						
						/* --- POSITIVE OR-CHAIN FOR LOWER BORDER ---
						* Example: "'bx' < attr" at index 1 with alphabet (a,b,c,...,y,z) --BECOMES--> &(!(attr=bx))(|(attr=bx*)(attr=by*)(attr=bz*)) 
						*/

						// Goes through all letters and create a atomic filter for those who need to be included into the OR-chain.
						for(let j = ALPHABET.length - 1; greaterLetterIndex < j; j--)	{
							greaterQueryPart += '(' + field + '=' + (greaterBase + ALPHABET[j])  + '*)';
						}
						if(firstCase)	{
							// Special addition for the very first round, because here the range has to be narrowed down less than in following cases.
							greaterQueryPart += '(' + field + '=' + greaterFilterValue + '*)';	
							
							// Only narrows down further if the filter is supposed to be a strict greater and not a greater-or-equal filter.
							if(!greaterEqual)	{
								greaterQueryPart = '(&(!(' + field + '=' + greaterFilterValue  + '))' + greaterQueryPart + ')';	
							}	
						}
					}
						
					firstCase = false;
					processedGreaterFilterOnce = true;
					query += greaterQueryPart;
				}
					
				// Create partquery to narrow down range if a letter exists at this index for the upper bound.
				if(i < smallerFilterValue.length && !cutExtension)	{
					
					let smallerCurrent = smallerFilterValue.charAt(i),
						smallerLetterIndex = ALPHABET.indexOf(smallerCurrent),
						smallerBase = smallerFilterValue.substring(0, i),
						smallerQueryPart = '';
						
					// Decides if to use an negative AND chain-from the start or an positive OR-chain from the end, depending on which needs less atomic filters.
					if(schema === 'AND' || schema !== 'OR' && ALPHABET.indexOf(smallerCurrent) + 1 >= ALPHABET.length / 2)	{
						
						/* --- NEGATIVE AND-CHAIN FOR UPPER BORDER ---
						* Example: "attr < 'bx'" at index 1 with alphabet (a,b,c,...,y,z) --BECOMES--> &(attr=b*)(!(|(attr=bx*)(attr=by*)(attr=bz*))) 
						*/
						
						// Goes through all letters and create a atomic filter for those who need to be included into the AND-chain.
						let parameterCount = 0;
						for(let j=ALPHABET.length - 1; smallerLetterIndex <= j; j--)	{
							smallerQueryPart += '(' + field + '=' + (smallerBase + ALPHABET[j]) + '*)';
							parameterCount++;
						}
						
						// Part query to allow all in subrange. The previous additions narrow this range down.
						smallerQueryPart = '(&(' + field + '=' + smallerBase + '*)(!' + (parameterCount > 1 ? '(|' : '') + smallerQueryPart + (parameterCount > 1 ? ')' : '') +  '))';
					}
					else	{
						
						/* --- POSITIVE OR-CHAIN FOR UPPER BORDER ---
						* Example: "attr < 'bc'" at index 1 with alphabet (a,b,c,...,y,z) --BECOMES--> (|(attr=b)(attr=ba*)(attr=bb*)) 
						*/

						// Special addition to include the pure search base.
						if(smallerBase !== '')	{
							smallerQueryPart += '(' + field + '=' + smallerBase + ')';
						}
						
						// Goes through all letters and create a atomic filter for those who need to be included into the OR-chain.
						for(let j=0; j < smallerLetterIndex; j++)	{
							smallerQueryPart += '(' + field + '=' + (smallerBase + ALPHABET[j])  + '*)';
						}
					}

					query += smallerQueryPart;
				}
				
				// Special procedure which narrows down not from one but both directions. Only necessary in the last round.
				if(cutExtension)	{

					let greaterCurrent = greaterFilterValue.charAt(i),
						greaterLetterIndex = ALPHABET.indexOf(greaterCurrent),
						sharedBase = greaterFilterValue.substring(0, i),
						smallerCurrent = smallerFilterValue.charAt(i),
						smallerLetterIndex = ALPHABET.indexOf(smallerCurrent),
						letterDistance = smallerLetterIndex - greaterLetterIndex,
						lastQueryPart = '';
					
					// Negative AND-chain, but does not go till the end but until a set border is reached.
					if(schema === 'AND' || schema !== 'OR' &&letterDistance >= ALPHABET.length / 2)	{
						
						/* --- NEGATIVE AND-CHAIN FOR BOTH BORDER ---
						* Example: "'bc' < attr < 'bx'" at index 1 with alphabet (a,b,c,...,y,z) --BECOMES--> &(attr=b*)(!(|(attr=b)(attr=ba*)(attr=bb*)(attr=bc)(attr=bx*)(attr=by*)(attr=bz*))) 
						*/
						
						// Goes through all letters and create a atomic filter for those who need to be included into the AND-chain.
						var parameterCount = 0;
						for(let j=0; j < ALPHABET.length; j++)	{
							if(j < greaterLetterIndex || smallerLetterIndex <= j || j === greaterLetterIndex && processedGreaterFilterOnce)	{
								lastQueryPart += '(' + field + '=' + (sharedBase + ALPHABET[j]) + '*)';
								parameterCount++;
							}
						}
						// Special case where the lower border is a substring of the upper border.
						if(!processedGreaterFilterOnce && !greaterEqual)	{
							// Normal Greater-filter is set and lower border is sub string of upper border.
							lastQueryPart += '(' + field + '=' + greaterFilterValue + ')';
							parameterCount++;
						}
						
						// Following additions only need to be made with a valid base which is present in both borders.
						if(sharedBase !== '')	{

							var lastQueryPartExtension = '';
							if(greaterFilterValue !== sharedBase)	{
								lastQueryPartExtension += '(' + field + '=' + sharedBase + ')';
								parameterCount++;
							}
							
							lastQueryPart = lastQueryPartExtension + lastQueryPart;
							if(parameterCount > 1 || (parameterCount > 0 && lastQueryPartExtension !== ''))	{
								lastQueryPart = '(|' + lastQueryPart + ')';
							}
							
							lastQueryPart = '(&(' + field + '=' + sharedBase + '*)(!' + lastQueryPart + '))';
						}
						// A different approach is necessary when there is no shared base. 
						else{
							lastQueryPart = '(&(' + field + '=*)(!' + (parameterCount > 1 ? '(|' : '') + lastQueryPart + (parameterCount > 1 ? ')' : '') + '))';
						}	
					}
					
					// OR chain as above, but does not go till the end but until a set border is reached
					else	{			

						/* --- POSITIVE OR-CHAIN FOR BOTH BORDER ---
						* Example: "'bm' < attr < 'bp'" at index 1 with alphabet (a,b,c,...,y,z) --BECOMES--> &(!(attr=bm))(|(attr=bm*)(attr=bn*)(attr=bo*)) 
						*/

						// Goes through all letters and create a atomic filter for those who need to be included into the OR-chain.
						for(let j=0; j < ALPHABET.length; j++)	{
							if(greaterLetterIndex < j && j < smallerLetterIndex)	{
								lastQueryPart += '(' + field + '=' + (sharedBase + ALPHABET[j]) + '*)';
							}
						}
						// A special case where the lower border is a substring of the upper border.
						if(!processedGreaterFilterOnce)	{
							if(sharedBase !== greaterFilterValue)	{
								if(greaterEqual)	{
									lastQueryPart += '(' + field + '=' + greaterFilterValue + '*)';
								}
								else	{
									lastQueryPart += '(&(!(' + field + '=' + greaterFilterValue + '))(' + field + '=' + greaterFilterValue + '*))';
								}
							}
							else if(greaterEqual)	{
								lastQueryPart += '(' + field + '=' + greaterFilterValue + ')';
							}
						}
					}
					
					query += lastQueryPart;
				}
			}
		}
		
		// Remove all filters with two or more following spaces since that is not valid ldap-syntax.
		query = query.replace(/\([^\(\)]*[ ]{2,}\*?\)/g,'');
		
		// Cut useless parts which get created in some rare cases.
		while(query.indexOf('(|)') !== -1 || query.indexOf('(&)') !== -1 || query.indexOf('(!)') !== -1)	{
			query = query.replace('(|)','');
			query = query.replace('(&)','');
			query = query.replace('(!)','');
		}
		
		while(/[^\\] /g.test(query))	{
			var index = query.search(/[^\\] /g) + 1;
			query = query.substring(0, index) + '\\' + query.substring(index);
		}
		
		// Extends the query to also filter on equality for the upper border if required.
		if(smallerEqual)	{
			query += '(' + field + '=' + smallerFilterValue + ')';
		}
		
		query += ')';
		
		// Removes the first OR filter if it is not necessary.
		var depth = 0;
		var bracketsOnLevel1 = 0;
		for(let i=0; i < query.length; i++)	{
			if(query.charAt(i) === '(')	{
				depth++;
			}
			else if(query.charAt(i) === ')')	{
				depth--;
				if(depth === 1)	{
					bracketsOnLevel1++;
				}
			}
		}
		
		// Removes a unnecessary AND-filter encapsulating the whole filter.
		if(bracketsOnLevel1 === 1)	{
			query = query.substring(2, query.length - 1);
		}
		
		return query;
	}	
	
	/**
	 *	Freezes code execution as long as specified.
	*
	*	@param seconds: The seconds to wait as integer.
	*/
	function pause(seconds)	{
		return new Promise(function(resolve, reject)	{
			setTimeout(function()	{
				return resolve(true);
			}, seconds * 1000);
		});
	}
	
	/**
	 * 	Sends the specified query to the NCSU-LDAP-API.
	 *
	 * 	@param query: The final query as string.
	 *	@returns An object containing the following members:
	 *		- entries: All found entries in an array
	 *		- complete: A boolean indicating if the LDAP-API returned all matching entries.
	 */
	function callLdapForeignApi(query) {
	
		console.log('--- START LDAP-CALL ---');
		return new Promise(function(resolve, reject) {
	
			console.log('Start Search');
			var ldapTime = new Date();
			let results = [];
			
			FOREIGN_API_CALLS++;
			
			// Fire the call.
			const qTime = Date.now();
			ldapConnection.search(foreignApi.dn, {scope: 'sub', filter: query}, function(err, res) {
	
				// Gets triggered for every returned entry.
				res.on('searchEntry', function(entry) {
					results.push(entry.object || entry);
				});
				// Gets called once the LDAP-API refuses to return further results.
				res.on('error', async function(err) {
					// Resolve on error.
					console.log('found: ' + results.length);
	
					// --- EVALUATION
					VOLUME_INCONSISTANT_CALLS++;
	
					TIME_PAUSE += pauseTime * 1000;
					var t = Date.now() - qTime;
					TIME_RESPONSE_TIME += t;
					
					await pause(pauseTime);					
					// Unbind from server and return found results. The result is volume inconsistant.
					return resolve({
						entries: results,
						complete: false
					});
				});
			// Gets called once when the LDAP-API finished returning entries without overreaching the maximal result size.
			res.on('end', async function(result) {
					// Reached when the served finished answering. Return found entries.
					
					console.log('time: ' + (new Date() - ldapTime) + 'ms');
					console.log('found: ' + results.length);
					console.log('status: ' + result.status);
	
					// --- EVALUATION
					VOLUME_CONSISTANT_CALLS++;
					TIME_PAUSE += pauseTime * 1000;
					var t = Date.now() - qTime;
					TIME_RESPONSE_TIME += t;
					
					// Execute an artificial pause.
					await pause(pauseTime);
					
					// Returned the found entries. The result is volume consistant.
					return resolve({
						entries: results,
						complete: true
					});
				});  
			});
		});
	}
	

	/**
	 *	Fires a provided query against some database.
	 *
	 *	@param query: The final query as string.
	 *	@returns the result of said query as provided by the database.
	 */
	function u_locQuery(query)	{
		return new Promise(function(resolve, reject)	{
			// Only executes if there is an actual query to execute.
			if(query !== '')	{
				console.log('Query: ' + query);
				
				// --- EVALUATION
				U_LOC_CALLS++;
				
				// Shot the query against the database.
				dbConnection2.query(query, function(err, res)	{
					if(err)	{
						console.log('Error: ' + JSON.stringify(err));
						return reject(err);
					}
					if(res)	{
						//console.log('Success: ' + JSON.stringify(res));			
					}
					
					return resolve(err ? err : res);
				});
			}
			// The query was empty. Deliver an empty result array.
			else {
				return resolve([]);
			}
		});
	}
	
	/**
	 *	A set functions to allow =, <= and >= in MySQL with trailing spaces.
	 *	@param left: Left side of the equation (X=y) as string
	 *	@param right: Right side of the equation (x=Y) as string
	 *	@returns The build filter as string
	 */
	function mimicGreaterEqual(left, right)	{
		// Functionally equal to <= .
		return / $|'.* '$/g.test(left) ? '(' + left + ' < ' + right + ' OR ' + left + ' LIKE ' + right + ')' : left + ' <= ' + right;
	}
	
	function mimicSmallerEqual(left, right)	{
		// Functionally equal to >= .
		return / $|'.* '$/g.test(left) ? '(' + left + ' > ' + right + ' OR ' + left + ' LIKE ' + right + ')' : left + ' >= ' + right;
	}
	
	function mimicEqual(left, right)	{
		// Functionally equal to = .
		return / $|'.* '$/g.test(left) ? left + ' LIKE ' + right : left + ' = ' + right;
	}
	
	
	
//	 -----------------------------------
//   +++++   ALGORITHM FUNCTIONS   +++++
//	 -----------------------------------
//
//   Helper Methods explicitly part of our proposed algorithms.


/**
 *	Queries the local database U_loc for the first g-many entries fitting 
 *	a specified filter according to ascending sort.
 *
 *	@param a: The specified filter as JSON. In detail:
 *				- v: A string specifying the attribute to query.
 *				- start: A string specifying the lower bound of the search range (filter will include this value)
 *				- end: A string specifying the upper bound of the search range (filter will exclude this value)
 *	@param g: The limiting value for the query.
 * 	@param L_TRENCH: A value indicating if the search is supposed to be executed on the LODIS-dimension. When set,
 *					 the range [a.start,a.end) will serve as a filter on the attribute specified in the global variable
 *					 UNIQUE_IDENTIFICATOR and NOT a.v. This filter will be combined with an equality-filter on all 
 *					 entries where the attribute a.v has the value specified in L_TRENCH.
 *	@returns The result for the query as returned by the database.
 */
function Q_loc(a, g, L_TRENCH)	{
		// Specifies the attribute to use for the range filter.
		const field = L_TRENCH ? UNIQUE_IDENTIFICATOR : a.v;
		let query = 'SELECT * FROM U_loc_' + MOCK_NAME + ' WHERE ';
		// If L_TRENCH is set, add an additional equalityFilter for the attribute a.v and the value in L_TRENCH.
		if(L_TRENCH)	{
			query += mimicEqual(a.v, mysql2.escape(L_TRENCH)) + ' AND ';
		}
		// Creates the range filter on the attribute saved in the variable "field". Adds the ascending sort and max result size count.
		query += mimicGreaterEqual(mysql2.escape(a.start), field) + ' AND ' + field + ' < ' + mysql2.escape(a.end) + ' ORDER BY ' + field + ' ASC LIMIT ' + (g+1) + ';';
		// Execute the query and return the result.
		return u_locQuery(query);
	}
	
	/**
	 *	Adds entries into the local database u_loc. Also deletes all old entries in the range the new entries got queried from. 
	 *
	 *	@param E: The new entries for the range provided as array.
	 *	@param field, start, end, L_TRENCH: The entries in E are result of a query for all entries fitting the following condition
	 *								L_TRENCH is falsy: The value for the attribute specified in field lies in the range [start,end)
	 *								L_TRENCH is a string: The value for the attribute specified in the global variable UNIQUE_IDENTIFICATOR
	 *													  lies in the range [start,end) AND the value for the attribute specified in field is
	 *													  equal to teh value of L_TRENCH.
	 *	@param full: A boolean indicating if the entries already existing in the specified range shall get deleted before inserting the new entries.
	 */
	function writeIntoU_loc(E, field, start, end, full, L_TRENCH)	{
		
		return new Promise(function(resolve, reject)	{
			let query = '';
			if(full)	{
				// Adds a deleting query on the specified range.
				query += 'DELETE FROM U_loc_' + MOCK_NAME + ' WHERE ' + mimicGreaterEqual(mysql2.escape(start), L_TRENCH ? UNIQUE_IDENTIFICATOR : field) 
				+ ' AND ' + (L_TRENCH ? UNIQUE_IDENTIFICATOR : field) + ' < ' + mysql2.escape(end) + ';';
			}
			// Adds the additional equality-filter if L_TRENCH is set.
			if(L_TRENCH)	{
				query = query.replace(/;$/, ' AND ' + mimicEqual(field, mysql2.escape(L_TRENCH)) + ';');
			}
			// Creates the new insert query. will rewrite entries with the same unuqie identificator.
			query += 'REPLACE INTO U_loc_' + MOCK_NAME + '(' + attributes.join(',') + ') VALUES'
			for(let i=0; i < E.length; i++)	{
				let E_values = [];
				for(let j=0; j < attributes.length; j++)	{
					E_values.push(mysql2.escape(E[i][attributes[j]]));
				}
				query += '(' + E_values.join(',') + '),';
			}
			query = query.replace(/,$/,';');
			
			// Fires all queries as part of a transaction.
		dbConnection2.beginTransaction(function(err)	{
				if(err)	{
					dbConnection2.rollback(function()	{
						return reject(err);
					});
				}
				dbConnection2.query(query, function(err)	{
					if(err)	{
						dbConnection2.rollback(function()	{
							return reject(err);
						});
					}
					dbConnection2.commit(function(err)	{
						if(err)	{
							dbConnection2.rollback(function()	{
								return reject(err);
							});
						}
						return resolve(true);
					});
				});
			});
		});
	}
		
	/**
	 *	Queries the foreign API for entries with a specified filter.
	 *
	 *	@param a: The specified filter as JSON. In detail:
	 *				- v: A string specifying the attribute to query.
	 *				- start: A string specifying the lower bound of the search range (filter will include this value)
	 *				- end: A string specifying the upper bound of the search range (filter will exclude this value)
	 *	@param g: The limiting value for the query.
	 * 	@param L_TRENCH: A value indicating if the search is supposed to be executed on the LODIS-dimension. When set,
	 *					 the range [a.start,a.end) will serve as a filter on the attribute specified in the global variable
	 *					 UNIQUE_IDENTIFICATOR and NOT a.v. This filter will be combined with an equality-filter on all 
	 *					 entries where the attribute a.v has the value specified in L_TRENCH.
	 *	@returns The result as specified by the method callLdapForeignApi().
	 */
	function B_g_Q_(a, L_TRENCH, g)	{
		
		return new Promise(async function(resolve, reject) {
			if(!LOCAL)	{
				// Decides the attribute to use for the filter.
				const vs = L_TRENCH ? UNIQUE_IDENTIFICATOR : a.v;
				let ldapQuery = createLdapRangeFilter(vs, '*' + a.start, a.end);
				// Adds the additional equality-filter when L_TRENCH is set.
				if(L_TRENCH)	{
					ldapQuery = '(&' + ldapQuery + '(' + a.v + '=' + L_TRENCH + '))';
				}
				
				// Starts to measure time.
				console.log('LDAP: ' + ldapQuery);
				let qTime = Date.now();

				// Method to execute the actual call.
				let res = await callLdapForeignApi(ldapQuery);
				
				/* When this is true, the API was not able to finish processing of the query due to a timeout.
					Reforms the query and starts anew.*/
				if(res.entries.length < g && res.complete === false)	{
	
					/* Remove all times from the timeouted query, since they are not part of our problem context and
					therefore processing caused by them is not to be considered in final evaluation results.*/
					var qT = Date.now() - qTime;
					TIME_TOTAL += qT;
					TIME_RESPONSE_TIME -= qT - pauseTime * 1000;
					TIME_PAUSE -= pauseTime * 1000;
					qTime = Date.now();
					
					// Reform the query with a different call schema.
					console.log('Timeout1! Enforce OR-chain to trigger index (hopefully)');
					ldapQuery = createLdapRangeFilter(vs, '*' + a.start, a.end, 'OR');
					if(L_TRENCH)	{
						ldapQuery = '&(' + ldapQuery + ')(' + a.v + '=' + L_TRENCH + ')';
					}
					
					/* Removes the call that caused the timeout from the evaluation result. They are not supposed to+
					be counted since our problem context doesn't include the possibility of API timeouts.*/
					FOREIGN_API_CALLS--;
					VOLUME_INCONSISTANT_CALLS--;
					
					console.log('LDAP: ' + ldapQuery);
					res = await callLdapForeignApi(ldapQuery);

					/* When this is true, the API was not able to finish processing of the query due to a timeout.
					Reforms the query and starts anew.*/
					if(res.entries.length < g && res.complete === false)	{				
						
						/* Remove all times from the timeouted query, since they are not part of our problem context and
						therefore processing caused by them is not to be considered in final evaluation results.*/
						var qT = Date.now() - qTime;
						TIME_TOTAL += qT;
						TIME_RESPONSE_TIME -= qT - pauseTime * 1000;
						TIME_PAUSE -= pauseTime * 1000;	
						qTime = Date.now();
					
						// Reform the query with a different call schema.
						console.log('Timeout2! Enforce AND-chain to trigger index (hopefully)');
						ldapQuery = createLdapRangeFilter(vs, '*' + a.start, a.end, 'AND');
						if(L_TRENCH)	{
							ldapQuery = '&(' + ldapQuery + ')(' + a.v + '=' + L_TRENCH + ')';
						}
						
						/* Removes the call that caused the timeout from the evaluation result. They are not supposed to+
						be counted since our problem context doesn't include the possibility of API timeouts.*/
						FOREIGN_API_CALLS--;
						VOLUME_INCONSISTANT_CALLS--;
						
						console.log('LDAP: ' + ldapQuery);
						res = await callLdapForeignApi(ldapQuery);
						if(res.entries.length < g && res.complete === false)	{
						
							/* Remove all times from the timeouted query, since they are not part of our problem context and
							therefore processing caused by them is not to be considered in final evaluation results.*/
							var qT = Date.now() - qTime;
							TIME_TOTAL += qT;
							TIME_RESPONSE_TIME -= qT - pauseTime * 1000;
							TIME_PAUSE -= pauseTime * 1000;
							qTime = Date.now();
					
							// Reform the query with a different call schema.
							console.log('Timeout3! Enforce OR-1-AND to trigger index (hopefully)');
							ldapQuery = createLdapRangeFilter(vs, '*' + a.start, a.end, 'MIXED1');
							if(L_TRENCH)	{
								ldapQuery = '&(' + ldapQuery + ')(' + a.v + '=' + L_TRENCH + ')';
							}
							
							/* Removes the call that caused the timeout from the evaluation result. They are not supposed to+
							be counted since our problem context doesn't include the possibility of API timeouts.*/
							FOREIGN_API_CALLS--;
							VOLUME_INCONSISTANT_CALLS--;
							
							console.log('LDAP: ' + ldapQuery);
							res = await callLdapForeignApi(ldapQuery);
							if(res.entries.length < g && res.complete === false)	{				
							
								/* Remove all times from the timeouted query, since they are not part of our problem context and
								therefore processing caused by them is not to be considered in final evaluation results.*/
								var qT = Date.now() - qTime;
								TIME_TOTAL += qT;
								TIME_RESPONSE_TIME -= qT - pauseTime * 1000;
								TIME_PAUSE -= pauseTime * 1000;
								qTime = Date.now();
					
								// Reform the query with a different call schema.
								console.log('Timeout4! Enforce AND-1-OR to trigger index (hopefully)');
								ldapQuery = createLdapRangeFilter(vs, '*' + a.start, a.end, 'MIXED2');
								if(L_TRENCH)	{
									ldapQuery = '&(' + ldapQuery + ')(' + a.v + '=' + L_TRENCH + ')';
								}
								
								/* Removes the call that caused the timeout from the evaluation result. They are not supposed to+
								be counted since our problem context doesn't include the possibility of API timeouts.*/
								FOREIGN_API_CALLS--;
								VOLUME_INCONSISTANT_CALLS--;
								
								console.log('LDAP: ' + ldapQuery);
								res = await callLdapForeignApi(ldapQuery);
								if(res.entries.length < g && res.complete === false)	{				
							
									/* Remove all times from the timeouted query, since they are not part of our problem context and
									therefore processing caused by them is not to be considered in final evaluation results.*/
									var qT = Date.now() - qTime;
									TIME_TOTAL += qT;
									TIME_RESPONSE_TIME -= qT - pauseTime * 1000;
									TIME_PAUSE -= pauseTime * 1000;
									qTime = Date.now();
					
									// Reform the query with a different call schema.
									console.log('Timeout5! Enforce OR-2-AND to trigger index (hopefully)');
									ldapQuery = createLdapRangeFilter(vs, '*' + a.start, a.end, 'MIXED3');
									if(L_TRENCH)	{
										ldapQuery = '&(' + ldapQuery + ')(' + a.v + '=' + L_TRENCH + ')';
									}
									
									/* Removes the call that caused the timeout from the evaluation result. They are not supposed to+
									be counted since our problem context doesn't include the possibility of API timeouts.*/
									FOREIGN_API_CALLS--;
									VOLUME_INCONSISTANT_CALLS--;
									
									console.log('LDAP: ' + ldapQuery);
									res = await callLdapForeignApi(ldapQuery);
									if(res.entries.length < g && res.complete === false)	{				
							
										/* Remove all times from the timeouted query, since they are not part of our problem context and
										therefore processing caused by them is not to be considered in final evaluation results.*/
										var qT = Date.now() - qTime;
										TIME_TOTAL += qT;
										TIME_RESPONSE_TIME -= qT - pauseTime * 1000;
										TIME_PAUSE -= pauseTime * 1000;
										qTime = Date.now();
					
										// Reform the query with a different call schema.
										console.log('Timeout6! Enforce AND-2-OR to trigger index (hopefully)');
										ldapQuery = createLdapRangeFilter(vs, '*' + a.start, a.end, 'MIXED4');
										if(L_TRENCH)	{
											ldapQuery = '&(' + ldapQuery + ')(' + a.v + '=' + L_TRENCH + ')';
										}
										
										/* Removes the call that caused the timeout from the evaluation result. They are not supposed to+
										be counted since our problem context doesn't include the possibility of API timeouts.*/
										FOREIGN_API_CALLS--;
										VOLUME_INCONSISTANT_CALLS--;
										
										console.log('LDAP: ' + ldapQuery);
										res = await callLdapForeignApi(ldapQuery);
										// The last possible reform failed. Abort execution.
										if(res.entries.length < g && res.complete === false)	{
											return resolve(null);
										}
									}
								}
							}
						}
					}
				}
				
				// Sorts the entries ascending.
				res.entries = res.entries.sort((b,c) => {
					
					if(b[a.v].toLowerCase() > c[a.v].toLowerCase())	{
						return 1;
					}
					else if(b[a.v].toLowerCase() < c[a.v].toLowerCase())	{
						return -1;
					}
					else	{
						if(b[UNIQUE_IDENTIFICATOR].toLowerCase() > c[UNIQUE_IDENTIFICATOR].toLowerCase())	{
							return 1;
						}
						else if(b[UNIQUE_IDENTIFICATOR].toLowerCase() < c[UNIQUE_IDENTIFICATOR].toLowerCase())	{
							return -1;
						}
					}
				});
				
				// Return the found entries.
				return resolve(res);
			}
			// Gathers the data from a mock foreign API served over a MariaDB database.
			else	{
				
				// Uses the node.js crypto library to ensure randomness.
				crypto = crypto ? crypto : require('crypto');
				
				// Prepare a query to return entries reqeusted in the provide filter as a foreign API with the limiting value "g" would.
				const field = L_TRENCH ? UNIQUE_IDENTIFICATOR : a.v;
				let hdQuery = 'SELECT * FROM hd_mock_' + MOCK_NAME + ' WHERE ';
				if(L_TRENCH)	{
					hdQuery += mimicEqual(a.v, mysql2.escape(L_TRENCH)) + ' AND ';
				}
				hdQuery += mimicGreaterEqual(mysql2.escape(a.start), field) + (!a.lodisStart || a.lodisEnd ? ' AND ' + field + ' < ' + mysql2.escape(a.end) : '') + ' ORDER BY RAND(___RANDO___) LIMIT ' + (g + 1)+ ';';
	
				/* Use the query itself as hash for the seed of the MariaDB-function RAND(). This way, one query, and only this query,
				will always use this same seed, which leads to pseudo-randomess as required.*/
				var hash = parseInt(crypto.createHash('md5').update(hdQuery).digest('hex').substring(0,40), 16);
				hdQuery = hdQuery.replace(/\_\_\_RANDO\_\_\_/, hash);
				
				FOREIGN_API_CALLS++;
			
				// Sends the query to the local foreign API mock.
				const startTime = Date.now();
				dbConnection2.query(hdQuery, function(err, data)	{
					if(err)	{
						return reject(err);
					}
					
					// Meauses different metrics for the evaluation.
					TIME_RESPONSE_TIME += Date.now() - startTime;					
					if(data.length < (g+1))	{
						VOLUME_CONSISTANT_CALLS++;
					}
					else	{
						VOLUME_INCONSISTANT_CALLS++;
					}
					
					// Sort the data by ascending order.
					data = data.sort((b,c) => {
						if(b[a.v].toLowerCase() > c[a.v].toLowerCase())	{
							return 1;
						}
						else if(b[a.v].toLowerCase() < c[a.v].toLowerCase())	{
							return -1;
						}
						else	{
							if(b[UNIQUE_IDENTIFICATOR].toLowerCase() > c[UNIQUE_IDENTIFICATOR].toLowerCase())	{
								return 1;
							}
							else if(b[UNIQUE_IDENTIFICATOR].toLowerCase() < c[UNIQUE_IDENTIFICATOR].toLowerCase())	{
								return -1;
							}
						}
					});
					
					/* Return the entries and an boolean indicationg if the result was volume consistant. It is important to remove one
					entry from the result set if it has a size of g+1, since we purposefully request a maximum of not g-many, but (g+1)-many entries.
					This way, we can determine if a result set with g-many entries contains all entries or is pnly a subset of the full set of all
					matching entries.*/
					return resolve({
						entries: data.length === g + 1 ? data.slice(1) : data,
						complete: data.length < g + 1
					});
				});
			}
		});
	}
	
	/** Reduces every provided object to the specified attribute.
	 *
	 *	@param E: An array containing objects.
	 *	@param v: The attribute to use as string.
	 *	@returns An array containing the value of each entry for the the attribute v.
	 */
	function V_v(E, v)	{
		return E.map(function(el)	{
			return el[v];
		})
	}
	
	
	
	//	 ---------------------
	//   +++++   SETUP   +++++
	//	 ---------------------
	//
	//	Initializes foreign libraries.

	/**
	 * Connects to the local MySQL/MariaDB datbase.
	 */
	function connectToDB()	{
		
		console.log('DB-Connection lost. Start Reconnecting');
		
		mysql2 = mysql2 || require('mysql');
		
		return new Promise(function(resolve, reject) {
			
			dbConnection2 = mysql2.createConnection({
				host     : '127.0.0.1',
				port     :  3306,
				database : 'scdm',
				user     : 'root',
				password : 'rootroot',
				debug    :  false,
				multipleStatements: true
			});
			
			// Connect to the database.
			dbConnection2.connect(function(err) {
			
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
	 *	Establishes a connection to an LDAP-API.
	*/
	function connectToLdapForeignApi()	{
		return new Promise(async function(resolve, reject)	{
			
			console.log('Configure LDAPjs');
			ldap = ldap ? ldap : require('ldapjs');
				
			console.log('LDAP-URL: ' + foreignApi.url);
			// Creates the ldap client.
			ldapConnection = ldap.createClient({
				url: foreignApi.url,
				timeout: 30000,
				connectTimeout: 30000
			});
				
			// Rejects the promise if something went wrong during the creation of the connection.
			ldapConnection.on('connectError', err => {
				if(err)	{
					return reject('connection error: ' + err.message);
				}
			});
	
			// Connect to the server.
			ldapConnection.bind('','',err => {
				if(err) {
					ldapConnection.unbind();
					return reject('bind error: ' + err.message);
				}
			});
			return resolve(true);
		});
	}
	
	

//	 -----------------------------------------
//   +++++   ALGORITHM IMPLEMENTATIONS   +++++
//	 -----------------------------------------
//
//	Main methods of our proposed solution.
	
	
	/**
	 *	Executes the RANK-SHRINK algorithm over a provided range as specified in its introducing paper (DOI: ).
	 */
	async function RANK_SHRINK(v, x_start, x_end, step, g, L_RANK_SHRINK) {
		
		console.log(v + ': ' + x_start + ' -> ' + x_end);
		return new Promise(async function(resolve, reject)	{
			// Creates the filter.
			let a = {v: v, start: x_start, end: x_end};	
			// Request all data matching the filter from the foreign API.
			const tempSave = await B_g_Q_(a, L_RANK_SHRINK, g);
			let resOf_B_g_Q_a_g = tempSave.entries;
			let B_g_Q_aIsQ_a = tempSave.complete;
			
			// If the result is volume inconsistent, save the gathered entries into the database. 
			if(B_g_Q_aIsQ_a)	{
				if(resOf_B_g_Q_a_g.length > 0)	{
					await writeIntoU_loc(resOf_B_g_Q_a_g, v, x_start, x_end, B_g_Q_aIsQ_a, L_RANK_SHRINK);
				}
				return resolve(null);
			}
			// if the result is volume inconsistent, then recursively trigger RANK-SHRINK-calls on smaller ranges.
			else	{
				const vs = L_RANK_SHRINK ? UNIQUE_IDENTIFICATOR : v;
				const border = resOf_B_g_Q_a_g[Math.ceil(g/2)][vs];
				var count = 0;
				// Counts how often the value of the element in the result set at index g/2 for the crawled attribute appears in the result set.
				resOf_B_g_Q_a_g.forEach((el) => {
					if(el[vs].toLowerCase() === border.toLowerCase())	{
						count++;
					}
				});
				// The result set appears less than (g/4)-many times. Start a two-way-split as specified in RANK-SHRINK's paper.
				if(count <= Math.ceil(g/4))	{
					console.log('O1: ' + border + ' (' + count + ')');
					if(x_start !== border)	{
						await RANK_SHRINK(v, x_start, border, step, g, L_RANK_SHRINK);
					}
					if(border !== x_end)	{
						await RANK_SHRINK(v, border, x_end, step, g, L_RANK_SHRINK);
					}
					return resolve(null);
				}
				// The result apears (g/4)-many times or more often. Start a three-way-split as specified in RANK-SHRINK's paper.
				else	{
					console.log('O2: ' + border + ' (' + count + ')');
					// Only start if the range has content.
					if(x_start !== border)	{
						await RANK_SHRINK(v, x_start, border, step, g, L_RANK_SHRINK);
					}
					/* Get the next value on the crawled domain after the value of the element in the result set at 
					index g/2 for the crawled attribute.*/
					const border2 = border + (ALPHABET_MAP[vs][0] !== ' ' ? ALPHABET_MAP[vs][0] : ALPHABET_MAP[vs][0] + ALPHABET_MAP[vs][1]);
					
					LODIS_ENTRIES++;
					
					// Starts a call on the next dimension as specified in RANK-SHRINK's paper for crawling over multiple dimensions.
					await RANK_SHRINK(v, ALPHABET_MAP[UNIQUE_IDENTIFICATOR][0], new Array(10).fill(ALPHABET_MAP[UNIQUE_IDENTIFICATOR][ALPHABET_MAP[UNIQUE_IDENTIFICATOR].length - 1]).join(''), step, g, border);
					
					// Only start if the range has content.
					if(border2 !== x_end)	{
						await RANK_SHRINK(v, border2, x_end, step, g, L_RANK_SHRINK);
					}
					return resolve(null);
				}
			}
		});
	}
	
	/**
	 *	Main part of the system. Crawls a specified range [x_start,x_end) over a specified attribute "v" (or UNIQUE_IDENTIFICATOR of L_TRENCH is set).
	 *	
	 *	@param v: The attribute to crawl entries with.
	 *	@param x_start: Lower bound of the range to crawl (the value itself is included in the crawl) as string.
	 *	@param x_end: Upper bound of the range to crawl (the value itself is excluded from the crawl) as string.
	 *	@param g: The limiting value enforced by the foreign API as integer.
	 *	@param step: The provided size for range guessing as integer.
	 */
	async function TRENCH(v, x_start, x_end, step, g, L_TRENCH)	{
		
		// Saves the original values for later use.
		let step_orig = step;
		let res_loc = [];
	
		/**
		 *	Determines the new range to request.
		 *
		 *	@param E_loc: an array of entries to serve as base for the operation.
		 *	@returns An object containing the following members:
		 *			- val: The found upper bound of the new search range as string.
		 *			- lodis: An indicator if an execution of L_TRENCH distrubed the execution of TRENCH. If set, then the value of x_start
		 *					 has to get incremented to the next value in the namspace to avoid reexecution of L_TRENCH over the same value.
		 */
			function SCAN(E_loc)	{
			return new Promise(async function(resolve, reject)	{
				let res_loc = E_loc;
				console.log('Perform SCAN for ' + res_loc.length + ' entries');
				// Starts at index step and goes through the array until a value is found that is not equal to the current value of x_start.
				if(res_loc.length >= step_orig)	{
					step = step_orig - 1;
					while(res_loc[step] === x_start)	{
						step = step + 1;
					}
					// If no value was found, then all entries have to have the same value as x_start. Crawl has to continue through LODIS.
					if(step === res_loc.length)	{
						console.log('Got LODIS at ' + x_start);
						// Crawler got stuck on LODIS. Should be impossible to achieve.
						if(v === UNIQUE_IDENTIFICATOR)	{
							throw new Error('Error: Got stuck on LODIS-dimension.');
						}
						
						// Log the access of LODIS.
						LODIS_ENTRIES++;
						
						/* Start a LODIS-subcall of TRENCH (=L_TRENCH) and pause the current execution. Once the L_TRENCH is done, resume the
						execution of TRENCH.*/
						await TRENCH(v, ALPHABET_MAP[UNIQUE_IDENTIFICATOR][0], 
							(new Array(30)).fill(ALPHABET_MAP[UNIQUE_IDENTIFICATOR][ALPHABET_MAP[UNIQUE_IDENTIFICATOR].length - 1]).join(''), step_orig, g, x_start);
						return resolve({
							val: x_start + (ALPHABET_MAP[v][0] !== ' ' ? ALPHABET_MAP[v][0] : ALPHABET_MAP[v][0] + ALPHABET_MAP[v][1]),
							lodis: true
						});
					}
					// A upper bound has been found.
					else	{
						console.log('SCAN determined end at ' + res_loc[step] + ' with step #' + (step+1));
						return resolve({
							val: res_loc[step],
							lodis: false
						});
					}
				}
				// The amount of provided entries is smaller than g. Therefore, the range can get savely extended to the end of the namespace.
				else	{
					console.log('SCAN reached end at ' + x_end);
					return resolve({
						val: x_end,
						lodis: false
					});
				}
			});
		}
		
		/**
		 *	Extracts data from the foreign API according to the currently provided range.
		 *
		 *	@x_current: The current upper bound of the range to search.
		 */
		async function EXTRACT(x_current)	{
			return new Promise(async function(resolve,reject)	{
				console.log('EXTRACT: ' + x_start + ' -> ' + x_current);
				// Creates the filter for the extraction.
				let a = {v: v, start: x_start, end: x_current};	
				// Query the foreign API.
				const tempSave = await B_g_Q_(a, L_TRENCH, g);
				// Abort the execution of an unsolvable problem was encountered in B_g_Q_().
				if(tempSave === null)	{
					return resolve(null);
				}
				// Save the results.
				let resOf_B_g_Q_a_g = tempSave.entries;
				let B_g_Q_aIsQ_a = tempSave.complete;
				
				// Write the gathered entries into the local database if there are any.
				if(resOf_B_g_Q_a_g.length > 0)	{
					await writeIntoU_loc(resOf_B_g_Q_a_g, v, x_start, x_current, B_g_Q_aIsQ_a, L_TRENCH);
				}
				
				// If the result was volume inconsistant, calculate a new upper search bound through SCAN() and search anew.
				if(!B_g_Q_aIsQ_a)	{
					console.log('Volume inconsistant result!');
					// Get potential candidates for the new upper bound.
					let Q_loc_result = await Q_loc(a, g, L_TRENCH);
					//Limit the entries to an array of values for the to-search attribute.
					Q_loc_result = V_v(Q_loc_result, L_TRENCH ? UNIQUE_IDENTIFICATOR : v);
					// Get the new uper bound.
					let scanRes = await SCAN(Q_loc_result);
					// Return a new value for x_start, since L_TRENCH already crawled a range.
					if(scanRes.lodis)	{
						return resolve(scanRes.val);
					}
					// Restart extract with the new range.
					else	{
						let x_next = scanRes.val;
						let extractRes = await EXTRACT(x_next);
						// Abort the execution of an unsolvable problem was encountered in B_g_Q_() as part of EXTRACT().
						if(extractRes === null)	{
							return resolve(null);
						}
					
						// Return the new lower search bound.
						return resolve(extractRes);
					}
				}
				// The query to the foreign API returned all entries. Set the used upper bound as new lower bound for the search range.
				else	{
					console.log('Got consistent result for ' + x_start + ' -> ' + x_current);
					return resolve(x_current);
				}
			});
		}
		
		return new Promise(async function(resolve, reject)	{
	
			// Proceed as lang as there is an area left to crawl.
			while (x_start.toLowerCase() < x_end.toLowerCase())	{
				// Set the search filter.
				let a_saved = {v: v, start: x_start, end: x_end};
				// Get potential upper search bounds for SCAN().
				let Q_loc_result = await Q_loc(a_saved, g, L_TRENCH);
				// Limit the entries to the values on the relevant attribute to crawl.
				Q_loc_result = V_v(Q_loc_result, L_TRENCH ? UNIQUE_IDENTIFICATOR : v);
				
				// Get a new upper search bound.
				let scanRes = await SCAN(Q_loc_result);
				
				// Increase the count of executed iterations.
				ITERATIONS++;
				
				// Increase the lower search bound if L_TRENCH crawled as part of some deeper nested function.
				if(scanRes.lodis)	{
					x_start = scanRes.val;
				}
				else	{
					let x_next = scanRes.val;
					// Peforms a data extraction with the new upper search bound.
					x_start = await EXTRACT(x_next);
					// An unsolvable range was crawled. Abort the execution of TRENCH.
					if(x_start === null)	{
						console.log('Received NCSU timeout');
						return resolve({
							reason: 'block',
							limit: x_next
						});
					}
					/* The AWS lambda is running low on time. Stop TRENCH and return the current
					lower search bound so that thenalgorithm can be started manually anew. */
					else if(con.getRemainingTimeInMillis() < 1000 * 60 * 1)	{
						console.log(con.getRemainingTimeInMillis());
						console.log('Received Lambda timeout');
						return resolve({
							reason: 'timeout',
							limit: x_start
						});
					}
				}
			}
			
			// Ends the algorithm on good terms.
			return resolve(null);
		});
	}
	
	
	//	 -------------------------------------------------
	//   +++++   MINIMAL CORE BUILD IMPLEMENTATION   +++++
	//	 -------------------------------------------------
	//
	//		Maintains the minimal core.
	//

	/**
	 *	Builds a perfect minimal core over the specified range. old splinter intercepting the range get deleted.
	 *
	 *	@param field, start, end: Specify the range [start,end) over the attribute in field or the value of UNIQUE_IDENTIFICATOR if lodis is set.
 	 *						If lodis is set, then splinters will get build over a lodis subrange of the range solely covering the value in lodis.
	 *	@param P: The buffer size for a splinter
	 *	@param G: The limiting value of the foreign API used.
	 */
	function buildPerfectMinimalCore(field, start, end, P, G, lodis)	{
		
		return new Promise(async function(resolve,reject)	{
			
			console.log('start to write splinters');
			
			// Sets the fields over which the splinters will get calculated.
			var searchField = lodis ? UNIQUE_IDENTIFICATOR : field;
			var searchStart = lodis ? 'lodisStart' : 'start';
			var searchEnd = lodis ? 'lodisEnd' : 'end';
			
			var splinter = {};
			var limit = start;
			var enter = true;
			var res = [];
			var completeInsert = '';
			var hadPreviousLodisSplinter = false;
			
			// Will create new splinters as long as the end of the range hasn't been reached and there are entries left to include in splinters.
			while(limit < end || (end === null && res.length > G - P) || enter)	{
				
				console.log('Current limit: ' + limit);
				enter = false;
				// Extracts all entries to contain in the new, optimally sized splinter.
				var followerQuery = 'SELECT ' + field + ', ' + UNIQUE_IDENTIFICATOR + ' FROM U_loc_' + MOCK_NAME + ' WHERE '
				if(lodis){
					followerQuery += mimicEqual(field, mysql2.escape(lodis)) + ' AND ';
				}
				followerQuery += mimicGreaterEqual(mysql2.escape(limit), searchField) + (end !== null ? ' AND ' + searchField + ' < ' + mysql2.escape(end) : '') + ' ORDER BY ' + field + ' ASC, ' + UNIQUE_IDENTIFICATOR + ' ASC LIMIT ' + (G - P + 1) + ';';
				
				// Execute the query.
				res = await u_locQuery(followerQuery);
				var am = res.length;
				// Removes the count of how many entries share the same value as the last one according to ascending order.
				for(var i = 0; !lodis && i < res.length; i++){
					if(res[i][field] === res[res.length - 1][field])	{
						am--;
					}
				}
				if(lodis)	{
					am--;
				}	
				
				// Checks if the next shard has to be a shard over LODIS.
				if(!lodis && am === 0 && res.length === (G - P + 1) && res[0][field] === limit)	{
					// Extract all entries matching the LODIS value.
					var res2 = await  u_locQuery('SELECT * FROM U_loc_' + MOCK_NAME + ' WHERE ' + mimicEqual(field,mysql2.escape(limit)) + ' ORDER BY ' + UNIQUE_IDENTIFICATOR + ' ASC;');
					// Create splinter until all entries found for the LODIS value are covered.
					for(var i=0; i < res2.length; i += G - P)	{					
						splinter = {
							start: limit,
							end: i + (G - P) < res2.length ? limit : limit + (ALPHABET_MAP[field][0] !== ' ' ? ALPHABET_MAP[field][0] : ALPHABET_MAP[field][0] + ALPHABET_MAP[field][1]),
							amount: Math.min(res2.length - i, G - P),
							lodisStart: i !== 0 ? res2[i][UNIQUE_IDENTIFICATOR] : ALPHABET_MAP[UNIQUE_IDENTIFICATOR][0],
							lodisEnd: i + (G - P) < res2.length ? res2[i + (G - P)][UNIQUE_IDENTIFICATOR] : null
						};
						
						var nsp = splinter;
						completeInsert += '(' + mysql2.escape(field) + ',' + mysql2.escape(nsp.start) + ',' + mysql2.escape(nsp.end) + ',' + mysql2.escape(nsp.lodisStart) + ',' + mysql2.escape(nsp.lodisEnd) + ',' + nsp.amount + '),';
					}
				}
				// No LODIS present. Will create regular splinters.
				else	{
					// Calculates the splinter.
					splinter = {
						field: field,
						start: lodis || limit,
						end: lodis ? (res.length < (G - P + 1)? lodis + (ALPHABET_MAP[field][0] !== ' ' ? ALPHABET_MAP[field][0] : ALPHABET_MAP[field][0] + ALPHABET_MAP[field][1]) : lodis)
								: (res.length < (G - P + 1) ? end : res[res.length - 1][field]),
						amount: res.length < (G - P + 1) ? res.length : am,
						lodisStart: lodis ? limit : null,
						lodisEnd: lodis ? (res.length < (G - P + 1) ? end : res[res.length - 1][searchField]) : null
					};
					
					/* If splinters are scheduled to get calculate on the LODIS dimension and only one splinter is calculated,
					remove the lodis indicators since the entries can also be contained in a regular splinter. */
					if(!hadPreviousLodisSplinter && res.length < (G - P + 1) 
							&& splinter.lodisStart === ALPHABET_MAP[UNIQUE_IDENTIFICATOR][0] && splinter.lodisEnd === null)	{
						splinter.lodisStart = null;
						splinter.lodisEnd = null;
					}					
					hadPreviousLodisSplinter = true;
	
					var nsp = splinter;				
					completeInsert += '(' + mysql2.escape(field) + ',' + mysql2.escape(nsp.start) + ',' + mysql2.escape(nsp.end) + ',' + mysql2.escape(nsp.lodisStart) + ',' + mysql2.escape(nsp.lodisEnd) + ',' + nsp.amount + '),';
				}
							
				// Update the border up to which splinters have been calculated
				limit = splinter[searchEnd];
			}
			
			// The query to delete old, overlapping splinters.
			let deleteQuery = 'DELETE FROM splinter WHERE ' + mimicEqual('field', mysql2.escape(field));
			if(lodis)	{
				deleteQuery += ' AND ' + mimicEqual('start', mysql2.escape(lodis));
			}
			deleteQuery += ' AND ' + mimicGreaterEqual(mysql2.escape(start), searchStart) + (end !== null ? ' AND ' + searchStart + ' < ' + mysql2.escape(end) : '') + ';';
			console.log('Delete entries with ' + deleteQuery);
			
			/* If a LODIS area doesn't contain a single entry anymore, insert a regular splinter over the range 
			so that full namespace coverage isn't lost.*/
			if(lodis && completeInsert === '')	{
				console.log('Inserted filler to keep coverage of area.');				
				completeInsert += '(' + mysql2.escape(field) + ',' + mysql2.escape(lodis) + ',' + mysql2.escape(lodis + (ALPHABET_MAP[field][0] !== ' ' ? ALPHABET_MAP[field][0] : ALPHABET_MAP[field][0] + ALPHABET_MAP[field][1])) + ',null,null,0),';
			}
			// Only execute if there is something to insert.
			if(completeInsert !== '')	{
				
				const completeQuery = deleteQuery + 'INSERT INTO splinter(field, start, end, lodisStart, lodisEnd, amount) VALUES ' + completeInsert.replace(/,$/, ';');
			
				// Perform the insert and delete as transaction.
				dbConnection2.beginTransaction(function(err)	{
					if(err)	{
						dbConnection2.rollback(function() {
							return reject(err);
						});
					}
					
					dbConnection2.query(completeQuery, function(err, data)	{
						dbConnection2.commit(function(err)	{
							if(err)	{
								dbConnection2.rollback(function() {
									return reject(err);
								});
							}
							return resolve(true);
						});
					});
				});
			}
			// Still perform the deletion if there is nothing to insert.
			else	{
				dbConnection2.query(deleteQuery, function(err, data)	{
					if(err)	{
						return reject(err);
					}
						return resolve(true);
				});
			}
		});
	}
	
	
	
	//	 ------------------------------
	//   +++++   LAMBDA HANDLER   +++++
	//	 ------------------------------
	//
	//	The method called by AWS to start a lambda. Schedules the executions of TRENCH
	//	for the evaluation.
	//


exports.handler = function(event, context, callback) {
	
	return new Promise(async function(resolve, reject)	{
		FOREIGN_API_CALLS = 0;
		VOLUME_CONSISTANT_CALLS = 0;
		VOLUME_INCONSISTANT_CALLS = 0;
		U_LOC_CALLS = 0;
		ITERATIONS = 0;
		TIME_TOTAL = 0;
		LODIS_ENTRIES = 0;
		TIME_PAUSE = 0;
		TIME_RESPONSE_TIME = 0;

		con = context || {
			getRemainingTimeInMillis: function()	{
				return Number.MAX_SAFE_INTEGER;
			}
		};
		
		let runCompleted = null;
		var exit = false;
		// If there is an area to crawl, execute TRENCH.
		if(event.parameter.dig)	{
			if(!LOCAL)	{
				// Establish a connection to the LDAP foreign API.
				await connectToLdapForeignApi();
			}
			// Start TRENCH once for all areas to crawl.
			for(var i=0; !exit && i < event.parameter.dig.length; i++)	{	
				const d = event.parameter.dig[i];

				// Start time measurement.
				var timeStart = Date.now();
				TIME_PAUSE = 0;
				TIME_RESPONSE_TIME = 0;
				
				// Crawl in the specified range in the provided mode.
				if(event.parameter.mode === 'RS')	{
					runCompleted = await RANK_SHRINK(d.v, d.start, d.end, parseInt(d.step), parseInt(d.g), d.lodis);
				}
				else	{
					runCompleted = await TRENCH(d.v, d.start, d.end, parseInt(d.step), parseInt(d.g), d.lodis);
				}
				
				// Finish time measurement.
				TIME_TOTAL = Date.now() - timeStart - TIME_TOTAL;
				TIME_RESPONSE_TIME = TIME_TOTAL - TIME_RESPONSE_TIME - TIME_PAUSE;
				TIME_PAUSE = TIME_TOTAL - TIME_PAUSE;
				
				// Logs the measured metrics.
				console.log('FOREIGN_API_CALLS: ' + FOREIGN_API_CALLS);
				console.log('VOLUME_CONSISTANT_CALLS: ' +  VOLUME_CONSISTANT_CALLS);
				console.log('VOLUME_INCONSISTANT_CALLS: ' + VOLUME_INCONSISTANT_CALLS);
				console.log('U_LOC_CALLS: ' + U_LOC_CALLS);
				console.log('ITERATIONS: ' + ITERATIONS);
				console.log('TIME_TOTAL: ' + TIME_TOTAL);
				console.log('LODIS_ENTRIES: ' + LODIS_ENTRIES);
				console.log('TIME_PAUSE: ' + TIME_PAUSE);
				console.log('TIME_RESPONSE_TIME: ' + TIME_RESPONSE_TIME);
				
				// If this is not null, something aborted the execution of TRENCH. SHould be impossible to achieve.
				if(runCompleted !== null)	{
					
					event.parameter.dig[i] = {
						type: d.type,
						v: d.v,
						start: runCompleted.limit,
						end: d.end,
						g: d.g,
						p: d.p,
						step: d.p,
						lodis: d.lodis,
					};
					
					event.parameter.dig = event.parameter.dig.slice(i);
					let request = {
						parameter: {
							dig: event.parameter.dig.slice(),
							number: event.parameter.number ? event.parameter.number + 1 : 1	
						}
					};
					
					if(event.parameter.core)	{
						request.parameter.core = JSON.parse(JSON.stringify(event.parameter.core));
						request.parameter.core.start = d.start;
					}
					
					exit = true;
					
					console.log('++++++++++++++++END: ' + event.parameter);
					console.log('++++++++++++++++REN: ' + JSON.stringify(request));
				}
			}
			if(!LOCAL)	{
				// Remove the LDAP bind.
				ldapConnection.unbind();
			}
		}
		// Builds a minimal core over the provided range if specified.
		if(event.parameter.core)	{
			const c = event.parameter.core;
			await buildPerfectMinimalCore(c.v, c.start, c.end, parseInt(c.p), parseInt(c.g), c.lodis);
		}
		
		// Cleans up the database after the evluation to be able to run a succeding one.
		let endQuery = 'TRUNCATE TABLE splinter; TRUNCATE TABLE u_loc_' + MOCK_NAME + ';';
		if(event.parameter.mode === 'T' && event.parameter.start === 'U')	{
			endQuery += ' TRUNCATE TABLE hd_mock_' + MOCK_NAME;
		}
		await u_locQuery(endQuery);
		
		console.log('Batch Search done.');
		
		return resolve(FOREIGN_API_CALLS);
	});
}

// Loads the script to fill the foreign API mock.
const DB = require('../scripts/loader.js');

/**
 *	Evaluation mode used for EV1: Will test the algorithm for different database sizes. Uses the script loader.js to build the database.
 */
async function contU()	{
	
	// Setup of the evaluation
	MOCK_NAME = 'names';
	UNIQUE_IDENTIFICATOR = 'uid';
	attributes = ['uid', 'sn'];
	let G = 50;
	var j = 10;
	await connectToDB();	
	var csv = ',,RANK_SHRINK,TRENCH\r\n';
	
	// Increases the database size with each iteration.
	for(var i=100; i <= 1800; i=i+j)	{
		
		// Fill the database of the foreign API mock according to the current value of "i".
		let dd = await DB.loadDB(i);
		dd = dd.length;
		
		// Triggers the RANK-SHRINK to crawl the whole namespace.
		console.log('Start with i=' + i);
		var calls = await exports.handler({
			parameter: {
				dig: [{
					v: 'sn',
					start: 'a',
					end : 'zzzzzzzzzz',
					step: Math.ceil(G/2),
					g: G,
					lodis: null
				}],
				core: {
					v: 'sn',
					start: 'a',
					end : 'zzzzzzzzzz',
					g: G,
					p: 10,
					lodis: null
				},
				mode: 'RS'
			}
		}, null, function() {});
		
		csv += i + ',' + dd + ',' + calls + ',';

		// Triggers TRENCH to call the whole namespace.
		calls = await exports.handler({
			parameter: {
				dig: [{
					v: 'sn',
					start: 'a',
					end : 'zzzzzzzzzz',
					step: Math.ceil(G/2),
					g: G,
					lodis: null
				}],
				core: {
					v: 'sn',
					start: 'a',
					end : 'zzzzzzzzzz',
					g: G,
					p: 10,
					lodis: null
				},
				mode: 'T',
				start: 'U'
			}
		}, null, function() {});
		
		csv += calls + '\r\n';
	}
	
	dbConnection2.end();
	
	// log the measured results in an csv-file.
	const fs = require('fs');
	fs.writeFile('callsU.csv' , csv, function(err) {
		if(err) {
			return console.log(err);
		}

		console.log("The file was saved!");
	}); 

}

/**
 *	Evaluation mode used for EV3: Will test the algorithm for different values of |U|/g. Uses the script loader.js to build the database.
 */
async function contUg()	{
	
	// Setup of the evaluation.
	MOCK_NAME = 'names';
	UNIQUE_IDENTIFICATOR = 'uid';
	attributes = ['uid', 'sn'];
	let G = 50;
	var j = 10;
	await connectToDB();
	
	const R = 30;
	var csv = ',,RANK_SHRINK,TRENCH\r\n';
	
	// Evalutes for different database sizes, but adapt the foreign API limiti g value so that the ratio |U|/g is kept.
	for(var i=200; i <= 1000; i=i+j)	{
		
		let dd = await DB.loadDB(i);
		dd = dd.length;
		// Starts with a ratio if |U|/g = 1/R.
		G = Math.floor(dd/R);
		console.log('Start with i=' + i);
		
		calls = await exports.handler({
			parameter: {
				dig: [{
					v: 'sn',
					start: 'a',
					end : 'zzzzzzzzzz',
					step: Math.ceil(G/2),
					g: G,
					lodis: null
				}],
				core: {
					v: 'sn',
					start: 'a',
					end : 'zzzzzzzzzz',
					g: G,
					p: 10,
					lodis: null
				},
				mode: 'T',
				start: 'U'
			}
		}, null, function() {});
		
		csv += '(' + dd + ',' + calls + ')\r\n';
	}
	
	dbConnection2.end();
	
	// Logs the measured result into a csv-file.
	const fs = require('fs');
	fs.writeFile('callsUg' + R + '.csv' , csv, function(err) {
		if(err) {
			return console.log(err);
		}

		console.log("The file was saved!");
	}); 
}


/**
 *	Evaluation mode used for EV2: Will test the algorithm for different values of g. Uses the script loader.js to build the database.
 */
async function contg()	{
	
	// Setup the evaluation.
	var j = 5;
	await connectToDB();
	MOCK_NAME = 'landslides';
	UNIQUE_IDENTIFICATOR = 'event_id';
	attributes = ['event_id', 'event_title', 'source_name', 'event_date', 'country_name', 'landslide_setting'];

	var csv = ',RANK_SHRINK,TRENCH\r\n';

	// Load the landslides dataset.
	await DB.loadRealDB();
	
	// Evaluate RANK-SHRINK as well as TRENCH multiple times on the same database, but with varying values for g.
	for(var i=15; i <= 100; i=i+j)	{
		
		var G = i;
		
		// Start RANK-SHRINK.
		console.log('Start with i=' + i);
		var calls = await exports.handler({
			parameter: {
				dig: [{
					v: 'event_title',
					start: 'a',
					end : 'zzzzzzzzzz',
					step: Math.ceil(G/2),
					g: G,
					lodis: null
				}],
				core: {
					v: 'event_title',
					start: 'a',
					end : 'zzzzzzzzzz',
					g: G,
					p: 10,
					lodis: null
				},
				mode: 'RS'
			}
		}, null, function() {});
		
		csv += G + ',' + calls + ',';

		// Start TRENCH.
		calls = await exports.handler({
			parameter: {
				dig: [{
					v: 'event_title',
					start: 'a',
					end : 'zzzzzzzzzz',
					step: Math.ceil(G/2),
					g: G,
					lodis: null
				}],
				core: {
					v: 'event_title',
					start: 'a',
					end : 'zzzzzzzzzz',
					g: G,
					p: 10,
					lodis: null
				},
				mode: 'T',
				start: 'g'
			}
		}, null, function() {});
		
		csv += calls + '\r\n';
	}
	
	dbConnection2.end();
	
	// Save the measured results as csv-file.
	const fs = require('fs');
	fs.writeFile('callsG.csv' , csv, function(err) {
		if(err) {
			return console.log(err);
		}

		console.log("The file was saved!");
	}); 
}

contUg();