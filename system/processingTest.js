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



//   ---------------------------------
//   +++++  EVALUATION COUNTERS  +++++
//   ---------------------------------
//
//	Collect different metrics about the execution.
//

// Logs the sum of all request metrics.
let FOREIGN_API_CALLS_TOTAL = 0;
let FOREIGN_API_CALLS_ITERATION = 0;
let DIGGING_FOREIGN_API_CALLS = 0;
let DIGGINGS = 0;
let EXTENSIONS = 0;
let E_GONE_FORWARD = 0;
let INSTANT_UPDATES = 0;
let FAILED_UPDATES = 0;
let TRENCH_CALLS = 0;
let TIME_PAUSE = 0;
let TIME_RESPONSE_TIME = 0;
let TIME_TOTAL = 0;
let UPDATE_QUERY = 0;

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

// Global variables, mainly imported modules.
var ldap,
	lambda,
	mysql,
	dbConnection,
	ldapConnection;

// Artificial break between LDAP-Calls in seconds.
const pauseTime = 3;

// The name of the used dataset.
var MOCK_NAME = 'landslides';
// The volume dimension enforcing unique values.
const CRAWL_DIM = MOCK_NAME !== 'landslides' ? 'uid' : 'event_id';
// Attributes to return to the user.
const COLUMNS_TO_SHOW = MOCK_NAME !== 'landslides' ? ['uid', 'sn'] : ['event_id', 'event_title', 'source_name', 'event_date', 'country_name', 
				'landslide_setting']

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


// Specifies if requests are made against the local mock foreign API.
let LOCAL = true;

// The limiting value enforced by the foreign API.
var G = !LOCAL ? 500 : 50;
// The buffer space reserved in splinters and navigators for new entries.
var P = !LOCAL ? 10 : 10;
// An attribute enforcing unique values on all entries (= v_unique)
let UNIQUE_IDENTIFICATOR = MOCK_NAME !== 'landslides' ? 'uid' : 'event_id';

// Attributes to distribute calls onto. User requests will be made proportionally distributed over these attributes.
var ATTR_CYCLE = MOCK_NAME !== 'landslides' ? ['sn'] : ['event_id','event_title'];


// Importing the BatchSearchService
const BS = require('./batchSearch.js');
let smallDB = false;

//	 --------------------------------
//   +++++   HELPER FUNCTIONS   +++++
//	 --------------------------------
//
//	General helper functions used throughout the system




/**
 *	Returns the provided word incremented on the last letter. For example, "abc" will become "abd".
 *	Incremeting the last letter flows over into the letter on the previous index. The successing letter
 *	is calculated according to the alphabet map provided for the specified field.
 *
 *	@param word: The word to increment as string.
 *	@param field: The attribute whose alphabet map shall be used as string.
 *	@returns the incremented word as string.
 */
function getNextInAlphabet(word, field, chainable)	{
	
	// Get the alphabet and maximal upper bound for the namespace.
	const ALPHABET = ALPHABET_MAP[field].split('');
	const BIGGER_THAN_BIGGEST_WORD_MOCK = new Array(50).fill(ALPHABET[ALPHABET.length - 1]).join('');
	
	// Sets to lower case to ease comparison.
	word = word.toLowerCase();
	
	var done = false;
	var wordSave = word;
	var replacerCount = 0;
	
	// Removes metadata from a previous call of this function.
	if(word.indexOf('#') !== -1)	{
		word = word.split('');
		word[word.indexOf('#')] = ALPHABET[0];
		word = word.join('');
	}
	else	{
		// Iterates until a letter got increased or all letters are recognized as unincreasable.
		while(!done && 0 < word.length)	{		
			
			var index = ALPHABET.indexOf(word.charAt(word.length - 1));
			// The letter is already the biggest possible one and thus unincreasable.
			if(index === ALPHABET.length - 1)	{
				word = word.substring(0, word.length - 1);
				replacerCount++;
			}
			// Letter gets increased.
			else	{	
				word = word.substring(0, word.length - 1) + ALPHABET[index + 1];
				word += (new Array(replacerCount)).fill('#').join('');
				done = true;
			}
		}
			
		// No letter was increasable. Add the smallest letter possible so that the result still got increased.
		if(!done)	{
			wordSave += ALPHABET[0];
			word = wordSave < BIGGER_THAN_BIGGEST_WORD_MOCK ? wordSave : BIGGER_THAN_BIGGEST_WORD_MOCK;
		}
	}
	
	// Removes the meta data if it's not needed.
	if(!chainable)	{
		word = word.replace(/#/g,'');
	}
	
	// Adds a non-space-character to prevent trailing spaces.
	if(word.charAt(word.length - 1) === ' ')	{
		word += ALPHABET[1];
	}
	
	return word;
}


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
 *		- res: All found entries in an array
 *		- full: A boolean indicating if the LDAP-API returned all matching entries.
 */
function callLdapForeignApi(query) {

	console.log('--- START LDAP-CALL ---');
	return new Promise(function(resolve, reject) {

		console.log('Start Search');
		var ldapTime = new Date();
		let results = [];
		
		const startTime = Date.now();
		ldapConnection.search(foreignApi.dn, {scope: 'sub', filter: query}, function(err, res) {

			// Gets triggered for every returned entry.
			res.on('searchEntry', function(entry) {
				let o = entry.object || entry;
				// Parses searchable values to lower case to enforce case-insensitivity.
				for(let s = 0; s < ATTR_CYCLE.length; s++)	{
					o[ATTR_CYCLE[s]] = o[ATTR_CYCLE[s]].toLowerCase();
				}
				results.push(o);
			});
			// Gets called once the LDAP-API refuses to return further results.
			res.on('error', async function(err) {
				// Resolve on error.
				console.error('error: ' + err.message);
				console.log('found: ' + results.length);
				
				// --- EVALUATION
				const resultTime = Date.now() - startTime;
				TIME_PAUSE += pauseTime * 1000;
				TIME_RESPONSE_TIME += resultTime;
				
				FAILED_UPDATES++;
				
				await pause(pauseTime);
				
				// Unbind from server and return found results, since the request could be successful as mentioned above.
				return resolve({
					res: results,
					full: false
				});
			});
			// Gets called once when the LDAP-API finished returning entries and the maximal amount of returnable entries was not reached.
			res.on('end', async function(result) {
				// Reached wehn the served finished answering. Return found entries.
				//console.log('query: ' + query);
				console.log('time: ' + (new Date() - ldapTime) + 'ms');
				console.log('found: ' + results.length);
				console.log('status: ' + result.status);

				INSTANT_UPDATES++;
				
				// --- EVALUATION
				const resultTime = Date.now() - startTime;
				TIME_PAUSE += pauseTime * 1000;
				TIME_RESPONSE_TIME += resultTime;
				
				await pause(pauseTime);
				
				// Returned the found entries. The result is volume consistant.
				return resolve({
					res: results,
					full: true
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
	
	return new Promise(async function(resolve, reject)	{
	
		FOREIGN_API_CALLS_TOTAL++;
		FOREIGN_API_CALLS_ITERATION++;
		
		// Query gets executed against a extern LDAP foreign API.
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
			var qTime = Date.now();
			
			// Method to execute the actual call.
			let res = await callLdapForeignApi(ldapQuery);

			/* When this is true, the API was not able to finish processing of the query due to a timeout.
			Reforms the query and starts anew.*/
			if(res.res.length < g && res.full === false)	{
				
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
					ldapQuery = '(&' + ldapQuery + '(' + a.v + '=' + L_TRENCH + '))';
				}
				
				/* Removes the call that caused the timeout from the evaluation result. They are not supposed to+
				be counted since our problem context doesn't include the possibility of API timeouts.*/
				FAILED_UPDATES--;
				
            	console.log('LDAP: ' + ldapQuery);
				res = await callLdapForeignApi(ldapQuery);
				
            	/* When this is true, the API was not able to finish processing of the query due to a timeout.
				Reforms the query and starts anew.*/
		    	if(res.res.length < g && res.fill === false)	{				
					
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
						ldapQuery = '(&' + ldapQuery + '(' + a.v + '=' + L_TRENCH + '))';
					}
					
					/* Removes the call that caused the timeout from the evaluation result. They are not supposed to+
					be counted since our problem context doesn't include the possibility of API timeouts.*/
					FAILED_UPDATES--;
				
					console.log('LDAP: ' + ldapQuery);
					res = await callLdapForeignApi(ldapQuery);
					if(res.res.length < g && res.full === false)	{
						
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
							ldapQuery = '(&' + ldapQuery + '(' + a.v + '=' + L_TRENCH + '))';
						}
						
						/* Removes the call that caused the timeout from the evaluation result. They are not supposed to+
				    	be counted since our problem context doesn't include the possibility of API timeouts.*/
				    	FAILED_UPDATES--;
				
                    	console.log('LDAP: ' + ldapQuery);
						res = await callLdapForeignApi(ldapQuery);
						if(res.res.length < g && res.full === false)	{				
						
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
								ldapQuery = '(&' + ldapQuery + '(' + a.v + '=' + L_TRENCH + '))';
							}
						
							 /* Removes the call that caused the timeout from the evaluation result. They are not supposed to+
				    		be counted since our problem context doesn't include the possibility of API timeouts.*/
				        	FAILED_UPDATES--;
							
							console.log('LDAP: ' + ldapQuery);
							res = await callLdapForeignApi(ldapQuery);
							if(res.res.length < g && res.full === false)	{				
						
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
				            	FAILED_UPDATES--;
								
                        		console.log('LDAP: ' + ldapQuery);
								res = await callLdapForeignApi(ldapQuery);
								if(res.res.length < g && res.full === false)	{				
						
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
										ldapQuery = '(&' + ldapQuery + '(' + a.v + '=' + L_TRENCH + '))';
									}
						
									/* Removes the call that caused the timeout from the evaluation result. They are not supposed to+
				                	be counted since our problem context doesn't include the possibility of API timeouts.*/
				                	FAILED_UPDATES--;
				
                                	console.log('LDAP: ' + ldapQuery);
									res = await callLdapForeignApi(ldapQuery);
									// The last possible reform failed. Abort execution.
									if(res.res.length < g && res.full === false)	{
										return resolve(null);
									}
								}
							}
						}
					}
				}
			}
		
			// Sorts the entries ascending.
			res.res = res.res.sort((b,c) => {
				
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
		// Query gets executed against a local foreign API mock.
		else	{
			// Calculates the query to get the entries in the area specified  by the filter
			const field = L_TRENCH ? UNIQUE_IDENTIFICATOR : a.v;
			let hdQuery = 'SELECT * FROM hd_mock_' + MOCK_NAME + ' WHERE ';
			if(L_TRENCH)	{
				hdQuery += mimicEqual(a.v, mysql.escape(L_TRENCH)) + ' AND ';
			}
			hdQuery += mimicGreaterEqual(mysql.escape(a.start), field) + (!a.start || a.end ? ' AND ' + field + ' < ' + mysql.escape(a.end) : '') + ' ORDER BY RAND() LIMIT ' + (g + 1)+ ';';
			console.log('YYY: ' + hdQuery);
			// Fire the query.
			dbConnection.query(hdQuery, function(err, data)	{
				if(err)	{
					return reject(err);
				}
				UPDATE_QUERY++;
				if(data.length < (g+1))	{
					console.log('Volume consistent result!: ' + data.length);
					INSTANT_UPDATES++;
				}
				else	{
					console.log('Volume inconsistant result!!');
					FAILED_UPDATES++;
				}
				/* Returns the found entries as well as an indicator if the result was volume consistent.
				Since we queried (g+1)-many entries, it is important to remove one entry from the set if it has a size of (g+1). */
				return resolve({
					res: (data.length < (g+1) ? data : data.slice(1)),//.map((el) => {return {object: el};}),
					full: data.length < (g+1)
				});
			});
		}
	});
}



/**
 *	A set functions to allow =, <= and >= in MySQL with trailing spaces.
 *	@param left: Left side of the equation (X=y) as string
 *	@param right: Right side of the equation (x=Y) as string
 *	@returns The build filter as string
 */

function mimicGreaterEqual(start, end)	{
	return / $|'.* '$/g.test(start) ? '(' + start + ' < ' + end + ' OR ' + start + ' LIKE ' + end + ')' : start + ' <= ' + end;
}
function mimicSmallerEqual(start, end)	{
	return / $|'.* '$/g.test(start) ? '(' + start + ' > ' + end + ' OR ' + start + ' LIKE ' + end + ')' : start + ' >= ' + end;
}
function mimicEqual(start, end)	{
	return / $|'.* '$/g.test(start) ? start + ' LIKE ' + end : start + ' = ' + end;
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
	mysql = mysql || require('mysql');
	let { dbConfig } = require('../globals');
	
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
 *	Establishes a connection to an LDAP-API.
 */
function connectToLdapForeignApi()	{
	return new Promise(async function(resolve, reject)	{
		
		console.log('Configure LDAPjs');
		ldap = ldap ? ldap : require('ldapjs');
			
		// Creates the ldap client.
		ldapConnection = ldap.createClient({
			url: foreignApi.url,
			timeout: 20000,
			connectTimeout: 20000
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
			else	{
				return resolve(true);
			}
		});
	});
}


/**
Setups all necessary components for the module (= step 1)
Many setups can get reused if the Lambda container gets reused to decrease runtime.
*/
async function config()	{
	
	console.log('--- START/REFRESH CONFIGURATION ---');
	
	console.log('configure DB');
	await connectToDB();
	
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
			// Shot the query against the database.
			dbConnection.query(query, function(err, res)	{
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



//	 -----------------------------------------
//   +++++   ALGORITHM IMPLEMENTATIONS   +++++
//	 -----------------------------------------
//
//	Main methods of our proposed solution.


/**
 *	Queries all outdated splinters intersecting the current request from the local database.
 *	@param input: The provided filter for the request as JSON, where the key is the attribute to query
 *			and the value specifies the value to search on said query. A wild-card-character (*) is allowed
 *			at the end of the string and effectively changes the filter into a begins-with-filter.
 *	@returns An array containing all found splinters.
 */
function getDueSplinters(input)	{
	
	return new Promise(function(resolve, reject) {
			
		console.log('--- SEARCH FOR DUE SPLINTERS ---');
		console.log('Parameter: ' + JSON.stringify(input));
		console.log('Search for splinters on fields ' + Object.keys(input).join(','));
		
		// Creater a query to search the outdated splinters in the maintenance list.
		var splinterQuery = 'SELECT field, start, end, lodisStart, lodisEnd, amount FROM maintenancelist WHERE ';
		for(var key in input)	{
			
			// Gets the alphabet for the current attribute.
			const ALPHABET = ALPHABET_MAP[key].split('');

			var LB;
			var UB;

			// Specifies the upper and lower bounds of the search area for the current attribute.
			LB = input[key].replace('*','');
			if(input[key].charAt(input[key].length - 1) !== '*')	{
				UB = LB + (ALPHABET[0] !== ' ' ? ALPHABET[0] : ALPHABET[0] + ALPHABET[1]);
			}
			else	{
				UB = getNextInAlphabet(input[key].replace('*',''), key);
			}
			
			splinterQuery += '(field = ' + mysql.escape(key) + ' AND (' + mysql.escape(LB) + ' < end OR (' + mimicEqual(mysql.escape(LB), 'end') + ' AND lodisStart IS NOT NULL)) AND start < ' + mysql.escape(UB) + ') OR ';
		}

		splinterQuery = splinterQuery.substring(0, splinterQuery.length - 4) + ' ORDER BY field ASC, start ASC;';
		
		// Search for splinters in the database.
		console.log('Search for splinters with query ' + splinterQuery);
		dbConnection.query(splinterQuery, function(err, res)	{

			console.log('--- SPLINTER QUERY RESULT ---');
			if(err)	{
				console.log('MySQL-ERROR: ' + JSON.stringify(err));
				return reject(res);
			}
			
			if(res.length > 0)	{
				console.log('Found ' + res.length + ' due splinters ' + JSON.stringify(res));
			}
			else{
				console.log('Found no due splinters. All shards are up to date');
			}		
			
			// return the found splinters or an empty array if none have been found.
			return resolve(res || []);
		});
	});
}


/**
 *	Sents as specified by the provided navigators. Writes the entries into the local database and
 *	deletes all old entries in the queried range if the query to the foreign API was volume consistent.
 *
 *	@param navigator: An array containing navigators. A navigator can include the following members:
 *			- field: Specifies the attribute to search on.
 *			- start: The lower bound of the search range.
 *			- end: The upper bound of the search range.
 *			- lodisStart (optional): The lower search bound on the LODIS volume dimension.
 *			- lodisEnd (optional): The lower search bound on the LODIS volume dimension.
 *	@returns An object containing the following members:
 *		- res: All found entries in an array
 *		- full: A boolean indicating if the LDAP-API returned all matching entries.
 */
function fireUpdateQuery(navigator)	{

	return new Promise(async function(resolve, reject)	{
		
		// Preset values dependent on the presence of a LODSI case to keep the code for query-building shorter.
		let r = {
			field: navigator.field,
			start: navigator.start,
			end: navigator.end,
			startDel: navigator.delStart || navigator.start,
			extra: ''
		}
		if(navigator.lodisStart)	{
			r = {
				field: UNIQUE_IDENTIFICATOR,
				start: navigator.lodisStart,
				end: navigator.lodisEnd,
				startDel: navigator.delLodisStart || navigator.lodisStart,
				extra: 'lodis'
			}
		}
		
		// Send the navigator as query to the foreign API.
		let result = await B_g_Q_({v: navigator.field, start: r.start, end: r.end}, navigator.lodisStart ? navigator.start : null, G);
		
		let u_locDelete = '';
		// Creates a query to delete all entries in the queried range if the query to the foreign API was volume consistant.
		if(result.full)	{
			u_locDelete = 'DELETE FROM u_loc_' + MOCK_NAME + ' WHERE ' + mimicGreaterEqual(mysql.escape(r.start), r.field) + (r.end ? ' AND ' + r.field + ' < ' + mysql.escape(r.end) : '') + (navigator.lodisStart ? ' AND ' + mimicEqual(navigator.field, mysql.escape(navigator.start)): '') + ';';
		}
		// Creates a query to insert the new entries into the local database.
		let u_locInsert = 'REPLACE INTO u_loc_' + MOCK_NAME + '(' + COLUMNS_TO_SHOW.join(',') + ') VALUES';
			
		// Escapes all gathered values to avoid an accidential SQL-Injection.
		result.res.forEach(function(el)	{
			u_locInsert += '(' + COLUMNS_TO_SHOW.map(function(col)	{
				return mysql.escape(el[col]);
			}).join(',') + '),';
		});
		u_locInsert = u_locInsert.replace(/,$/, ';').replace(/^.* VALUES$/,'');
		
		// Execute all prepared SQL-queries as one transaction.
		dbConnection.beginTransaction((err)	=> {	
			if(err)	{
				dbConnection.rollback(() => {
					return reject(err);
				});
			}
			dbConnection.query(u_locDelete + u_locInsert, function(err)	{
				if(err)	{
					dbConnection.rollback(() => {
						return reject(err);
					});
				}
				dbConnection.commit((err) => {
					if(err)	{
						dbConnection.rollback(() => {
							return reject(err);
						});
					}
					return resolve({
						end: r.end,
						full: result.full
					});
				});
			});
		});
	});
}

/**
 *	Builds a perfect minimal core over the specified range. The mincore will not get saved in the database, but returned as result of this
 *	function. The MINCORE build through this function will not necessarily stop at the provided upper bound, but extend its head splinter
 *	as much as necessary to achieve an optimal size.
 *
 *	@param field, start, end: Specify the range [start,end) over the attribute in field or the value of UNIQUE_IDENTIFICATOR if lodis is set.
 *						If lodis is set, then splinters will get build over a lodis subrange of the range solely covering the value in lodis.
 *	@param P: The buffer size for a splinter.
 *	@param G: The limiting value of the foreign API used.
 */
function buildTemporaryCore(field, start, end, lodis)	{
	
	return new Promise(async function(resolve,reject)	{
		
		console.log('start to write temp core');
		
		// Preset values dependent on the presence of LODIS.
		var searchField = lodis ? UNIQUE_IDENTIFICATOR : field;
		var searchStart = lodis ? 'lodisStart' : 'start';
		var searchEnd = lodis ? 'lodisEnd' : 'end';
		
		var splinter = {};
		var limit = start;
		var enter = true;
		var res = [];
		var currentSplinters = [];
		var hadPreviousLodisSplinter = false;

		// Will create new splinters as long as the end of the range hasn't been reached and there are entries left to include in splinters.
		while(limit < end || (end === null && res.length > G - P) || enter)	{
			
			enter = false;
			// Extracts all entries to contain in the new, optimally sized splinter.
			var followerQuery = 'SELECT ' + field + ', ' + UNIQUE_IDENTIFICATOR + ' FROM u_loc_' + MOCK_NAME + ' WHERE '
			if(lodis){
				followerQuery += mimicEqual(field, mysql.escape(lodis)) + ' AND ';
			}
			followerQuery += mimicGreaterEqual(mysql.escape(limit), searchField);
			const fullFollowerQuery = followerQuery + (end !== null ? ' AND ' + searchField + ' < ' + mysql.escape(end) : '') + ' ORDER BY ' + field + ' ASC, ' + UNIQUE_IDENTIFICATOR + ' ASC LIMIT ' + (G - P + 1) + ';';
			
			/* A special verious of the fullFollowerQuery without an upper bound. This query will get used to query the data for the head splinter
			if the fullFollowerQuery returns a result set of not optimal size due to the upper bound present in it.*/
			const limitlessFollowerQuery = followerQuery + ' ORDER BY ' + field + ' ASC, ' + UNIQUE_IDENTIFICATOR + ' ASC LIMIT ' + (G - P + 1) + ';';
			
			// Execute the query.
			res = await u_locQuery(fullFollowerQuery);
			if(res.length < G - P + 1)	{
				res = await u_locQuery(limitlessFollowerQuery);
			}
			
			// Removes the count of how many entries share the same value as the last one according to ascending order.
			var am = res.length;
			for(var i = 0; !lodis && i < res.length; i++){
				if(res[i][field] === res[res.length - 1][field])	{
					am--;
				}
			}
			if(lodis)	{
				am--;
			}	
			
			// Checks if the next splinter has to be a splinter over LODIS.
			if(!lodis && am === 0 && res.length === (G - P + 1) && res[0][field] === limit)	{
				// Extract all entries matching the LODIS value.
				var res2 = await  u_locQuery('SELECT * FROM u_loc_' + MOCK_NAME + ' WHERE ' + mimicEqual(field,mysql.escape(limit)) + ' ORDER BY ' + UNIQUE_IDENTIFICATOR + ' ASC;');
				// Create splinter until all entries found for the LODIS value are covered.
				for(var i=0; i < res2.length; i += G - P)	{
					splinter = {
						field: field,
						start: limit,
						end: i + (G - P) < res2.length ? limit : limit + (ALPHABET_MAP[field][0] !== ' ' ? ALPHABET_MAP[field][0] : ALPHABET_MAP[field][0] + ALPHABET_MAP[field][1]),
						amount: Math.min(res2.length - i, G - P),
						lodisStart: i !== 0 ? res2[i][UNIQUE_IDENTIFICATOR] : ALPHABET_MAP[UNIQUE_IDENTIFICATOR][0],
						lodisEnd: i + (G - P) < res2.length ? res2[i + (G - P)][UNIQUE_IDENTIFICATOR] : null
					};
					currentSplinters.push(splinter);
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

				currentSplinters.push(splinter);
			}
			
			// Update the border up to which splinters have been calculated.
			limit = splinter[searchEnd];
		}
		
		// Return the splinters of the calculated MINCORE.
		return resolve(currentSplinters);
	});
}


//	 -----------------------------------------
//   +++++   ALGORITHM IMPLEMENTATIONS   +++++
//	 -----------------------------------------
//
//	Main methods of our proposed solution.


exports.handler = async function(event, context, callback)	{
	
	// Starts the time measurement.
	console.log('--- START LAMBDA (READ) ---');
	console.log('Time: ' + new Date());

	var input = event.queryStringParameters;

	
	var response = '';
	// Logs if the execution ended through an error.
	var wasError = false;
	// Logs if the foreign API stopped answering queries.
	var apiAnswers = true;
	try	{
		
		// Gets all outdated splinters for the provided request.
		var splinters = await getDueSplinters(input);

		// Starts the updating process. Will get skipped if no outdated splinters have been found.
		if(splinters.length > 0)	{
			
			/* Sorts the splinters ascending on the volume dimension they cover first, then their value on said dimension and
			then on the dimension enforcing unique values.*/
			splinters.sort(function(a,b)	{
				a.field = a.field.toLowerCase();
				b.field = b.field.toLowerCase();
				// Sort by volume dimension.
				if(a.field > b.field)	{
					return 1;
				}
				else if(a.field < b.field)	{
					return -1;
				}
				else	{
					// If both entries have the same volume dimension, order by their values on said dimension.
					a.start = a.start.toLowerCase();
					b.start = b.start.toLowerCase();
					if(a.start > b.start)	{
						return 1;
					}
					else if(a.start < b.start)	{
						return -1;
					}
					/* If volume dimension and value are equal, the splinters will have a subrange over the dimension
					enforcing unique values. Order by the values on this dimension ascending.*/
					else	{
						a.lodisStart = a.lodisStart.toLowerCase();
						b.lodisStart = b.lodisStart.toLowerCase();
						if(a.lodisStart > b.lodisStart)	{
							return 1;
						}
						else if(a.lodisStart < b.lodisStart)	{
							return -1;
						}
					}
				}
			});
			
			/* Combines neigbouring splinters on the same volume dimension into a one area, called hole.
			Holes are bound to one volume dimension and can not contain areas covered by LODIS. A LODIS 
			area gets covered by a sperate splinter.*/
			console.log('Sorted: ' + JSON.stringify(splinters));
			console.log('.');
			console.log('--- COMBINE TO HOLES 1 ---');
			for(var j=0; j < splinters.length; j++)	{
				/* Checks if a followup to the current splinter exists and if the following splinter is on 
				the same volume dimension as the current one.*/
				if(j < splinters.length - 1 && splinters[j].field === splinters[j+1].field)	{
					/* Checks if the areas covered by the current and the following splinters directly neighbour each other. If yes,
					absorb the next splinter's range into the current ones. Decrease the counter so that the current splinter gets checked
					against its new following splinter.*/
					if(!splinters[j].lodisStart && !splinters[j+1].lodisStart && (splinters[j].end == null || splinters[j].end >= splinters[j+1].start))	{
						splinters[j].end = splinters[j].end < splinters[j+1].end || splinters[j+1].end === null ? splinters[j+1].end : splinters[j].end;
						splinters.splice(j + 1, 1);
						j--;
					}
					/* Same check as above, but on the dimension enforcing unique values. Requires the field lodisStart to be set on both splinters,
					which tells that both cover a LODIS-area.*/
					else if(splinters[j].start === splinters[j+1].start && splinters[j].lodisStart && splinters[j+1].lodisStart && (splinters[j].lodisEnd === null || splinters[j].lodisEnd >= splinters[j+1].lodisStart))	{
						splinters[j].end = splinters[j].end < splinters[j+1].end || splinters[j+1].end === null ? splinters[j+1].end : splinters[j].end;
						splinters[j].lodisEnd = splinters[j].lodisEnd < splinters[j+1].lodisEnd || splinters[j+1].lodisEnd === null ? splinters[j+1].lodisEnd : splinters[j].lodisEnd;
						splinters.splice(j + 1, 1);
						j--;
					}
					// Current and following splinter didn't got fused into a new area.
					else if(!splinters[j].lodisStart)	{
						console.log('Created Hole: (' + splinters[j].start + ' -> ' + splinters[j].end + ')');
					}
					else	{
						console.log('Created LODIS-Hole: (' + splinters[j].start + ', ' + splinters[j].lodisStart + ' -> ' + splinters[j].lodisEnd + ')');
					}
				}
			}
			// Message to log the hole created by the last splinter.
			if(!splinters[splinters.length - 1].lodisStart)	{
				console.log('Created Hole: (' + splinters[splinters.length - 1].start + ' -> ' + splinters[splinters.length - 1].end + ')');
			}
			else	{
				console.log('Created LODIS-Hole: (' + splinters[splinters.length - 1].start + ', ' + splinters[splinters.length - 1].lodisStart + ' -> ' + splinters[splinters.length - 1].lodisEnd + ')');	
			}
			
			// Calculates a perfect, temporary MINCORE for each hole.  
			console.log('--- CALCULATE UPDATES ---');
			var newSplinters = [];
			for(var i=0; i < splinters.length; i++)	{
				const el = splinters[i];
				console.log('Splinter: ' + JSON.stringify(el));
				
				// Builds a temporary MINCORE for the provided hole. Splinters in this MINCORE are called navigators.
				const newBatch = await buildTemporaryCore(el.field, el.lodisStart || el.start, el.lodisStart ? el.lodisEnd : el.end, el.lodisStart ? el.start : null);
				
				console.log('Calculated updates ' + JSON.stringify(newBatch));
				const last = newBatch[newBatch.length - 1];
				let noCore = false;
				/*The temporary MINCORE is allowed to create navigators, which reach into the areas of existing splinters. Therefore,
				merge the hole with the following one one the same volume dimension if the areas of both holes overlap now.
				A new perfect, temporary MINCORE will get created for the combined area.*/ 
				if(i < splinters.length - 1 && splinters[i].field === splinters[i+1].field && 
				((splinters[i+1].lodisStart && last.lodisStart && last.lodisEnd >= splinters[i+1].lodisStart)
				|| (!splinters[i+1].lodisStart && !last.lodisStart && last.end >= splinters[i+1].start)))	{
					console.log('TempCore reaches with "' + last.end + ',' + last.lodisEnd + '" into next hole at ' + splinters[i+1].end + ',' + splinters[i+1].lodisEnd + '. Combine both');
					// Combines both holes.
					splinters[i] = {
						field: splinters[i].field,
						start: splinters[i].start,
						end: splinters[i+1].end,
						lodisStart: splinters[i].lodisStart,
						lodisEnd: splinters[i+1].lodisEnd
					};
					splinters.splice(i+1, 1);
					i--;
					// Indicates that a merge was performed, which invalidates the current temporary MINCORE of the hole.
					noCore = true;
				}
				
				// No hole merge was necessary. Extend the hole to the upper bound of its temporary MINCORE if necessary.
				else if(splinters[i].lodisStart && last.lodisEnd > splinters[i].lodisEnd)	{
					console.log('TempCore-LODIS-end "' + splinters[i].lodisEnd + '" is too small. Extend to ' + last.lodisEnd + '. Combine both');
					
					splinters[i].end = last.end;
					splinters[i].lodisEnd = last.lodisEnd;
					newSplinters = newSplinters.concat(newBatch);
				}
				else if(!splinters[i].lodisStart && last.end > splinters[i].end)	{
					console.log('TempCore-end "' + splinters[i].end + '" is too small. Extend to ' + last.end);
					splinters[i].end = last.end;	
					newSplinters = newSplinters.concat(newBatch);
				}
				else{
					newSplinters = newSplinters.concat(newBatch);
				}

				
				/* Delete every splinter from the maintenance list whose area is included in the current hole, since its range will get updated
				as part of the following update process.*/
				const deleteCall = function()	{
					return new Promise(function(resolve, reject)	{
						let maintenanceListDelete = 'DELETE FROM maintenancelist WHERE ' + mimicEqual('field', mysql.escape(splinters[i].field)) + ' AND ' + mimicGreaterEqual(mysql.escape(splinters[i].start), 'start') + (splinters[i].end !== null ? ' AND ' + mimicGreaterEqual('end', mysql.escape(splinters[i].end)) : '') + ' AND lodisStart IS NULL;';
						if(splinters[i].lodisStart)	{
							maintenanceListDelete = 'DELETE FROM maintenancelist WHERE ' + mimicEqual('field', mysql.escape(splinters[i].field)) + ' AND ' + mimicEqual('start', mysql.escape(splinters[i].start)) + ' AND ' + mimicGreaterEqual(mysql.escape(splinters[i].lodisStart), 'lodisStart') + (splinters[i].lodisEnd !== null ? ' AND ' + mimicGreaterEqual('lodisEnd', mysql.escape(splinters[i].lodisEnd)) : '') + ';';
						}
						dbConnection.query(maintenanceListDelete, function(err, data)	{
							if(err)	{
								return reject(err);
							}
							return resolve(true);					
						});
					});
				}
				// Only executes the deletion if the current temporary MINCORE is not due to get recalculated.
				if(!noCore)	{
					await deleteCall();
				}
			}
			
			// the final holes.
			var holes = splinters;
			// the final navigators.
			splinters = newSplinters;
			
			// Execute the queries specified by the navigators.
			console.log('--- EXECUTE UPDATE-QUERIES ---');	
			var digOrders = [];
			var maxNav = '';
			for(var i=0; i < splinters.length; i++) {
				
				console.log('Fire Update #' + (i+1));

				/* Executes the update query against the foreign API and returns the found entries as well as
				a value indicating if the value is volume consistant. If null gets returned, then the execution
				ran into an unsolvable problem, which leads to the descheduling of all other update queries.*/
				const rez = await fireUpdateQuery(splinters[i]);
				
				// Saves in the navigator if its result was volume consistant or inconsistant.
				splinters[i].full = rez.full;
				
				/* If the result is volume inconsistent, schedule a crawl with TRENCH over the area in
				the BatchSearchService.*/
				if(!rez.full)	{
					digOrders.push({
						v: splinters[i].field,
						start: splinters[i].lodisStart || splinters[i].start,
						end: splinters[i].lodisStart ? splinters[i].lodisEnd : splinters[i].end,
						g: G,
						step: Math.ceil(G/2),
						lodis: splinters[i].lodisStart ? splinters[i].start : null
					});
					console.log(JSON.stringify(digOrders[digOrders.length - 1]));
				}
			}
			
			console.log(JSON.stringify(digOrders));
			
			// Processes the followup operations for each hole.
			for(var k=0; k < holes.length; k++)	{
					
				const executeFollowup = function()	{

					return new Promise(async function(resolve, reject)	{
						/* The temporary MINCORE is allowed to create navigators, which reach into the areas of existing splinters. Therefore,
						remove areas from splinters which are now covered by a navigator of a temporary MINCORE. Splinters completely covered by the temporary MINCORE already got deleted, so there are only overlapping splinters left. Gets executed on the splinter table as well as the maintenance list.*/
						let followerQuery = 'SELECT end AS end FROM splinter WHERE ' + mimicEqual('field', mysql.escape(holes[k].field)) + ' AND ' +
							mimicGreaterEqual(mysql.escape(holes[k].start), 'start') + (holes[k].end ? ' AND start < ' + mysql.escape(holes[k].end) : '') +
							' ORDER BY start DESC LIMIT 1;';
						if(holes[k].lodisStart)	{
							followerQuery = 'SELECT lodisEnd AS end FROM splinter WHERE ' + mimicEqual('field', mysql.escape(holes[k].field)) + ' AND ' + mimicEqual('start', mysql.escape(holes[k].start)) + ' AND ' + mimicGreaterEqual(mysql.escape(holes[k].lodisStart), 'lodisStart') + (holes[k].lodisEnd ? ' AND lodisStart < ' + mysql.escape(holes[k].lodisEnd) : '') +
							' ORDER BY lodisStart DESC LIMIT 1;';
						}
						
						console.log(followerQuery);
						// Execute the query to find overlaps with old splinters. 
						dbConnection.query(followerQuery, async function(err, res)	{
							if(err)	{
								return reject(err);
							}
							/* An overlapping splinter was found. Therefore, adapt it in the maintenancelist and splinter table to not overlap anymore
							with new splinters, which are due to get calculated from the queried navigators.*/
							if(res[0] && (holes[k].lodisStart === null && holes[k].end !== res[0].end || holes[k].lodisStart !== null && holes[k].lodisEnd !== res[0].end))	{
								console.log(JSON.stringify(holes[k]));
								
								// Execute the adapt-query.
								const adapt = function()	{
									return new Promise((resolve2, reject2) => {
										
										let tickets = 2;
										let uField = 'start';
										let uVal = holes[k].end;
										let uCon = 'end';
										let uIden = holes[k].field;
										if(holes[k].lodisStart)	{
											uField = 'lodisStart';
											uVal = holes[k].lodisEnd;
											uCon = 'lodisEnd';
											uIden = UNIQUE_IDENTIFICATOR;
										}
										// Calculate the query.
										const uQuery1 = 'UPDATE splinter AS s SET ' + uField + '=' + mysql.escape(uVal) + ', amount = (SELECT COUNT(*) FROM u_loc_' + MOCK_NAME + ' WHERE ' + mimicGreaterEqual(mysql.escape(uVal), uIden) + ' AND ' + uIden + ' < s.end' + (holes[k].lodisStart ? ' AND ' + mimicEqual(holes[k].field, mysql.escape(holes[k].start)) : '') + ') WHERE ' + mimicEqual('field', mysql.escape(holes[k].field)) + ' AND ' + mimicEqual(uCon, mysql.escape(res[0].end)) + (holes[k].lodisStart ? ' AND start=' + mysql.escape(holes[k].start) : ' AND lodisStart IS NULL') + ';';
										// Executes the query against the splinter table.
										dbConnection.query(uQuery1, function(err, data)	{
											if(err)	{
												return reject2(err);
											}
											// Only resolve once both updates finished.
											if(--tickets === 0)	{
												return resolve2(true);
											}
										});
										// Execute the same query against the maintenancelist.
										const uQuery2 = uQuery1.replace('UPDATE splinter','UPDATE maintenancelist');
										dbConnection.query(uQuery2, function(err, data)	{
											if(err)	{
												return reject2(err);
											}
											// Only resolve once both updates finished.
											if(--tickets === 0)	{
												return resolve2(true);
											}
										});
									});
								};
								await adapt();
								
								EXTENSIONS++;
								
								// Logs if an overlap was found.
								if(res[0].end === null || holes[k].lodisStart === null && holes[k].end < res[0].end || holes[k].lodisStart !== null && holes[k].lodisEnd < res[0].end)	{
									console.log('Old splinter now reaches from "' + holes[k][holes[k].lodisStart ? 'lodisEnd' : 'end'] + '" to "' + res[0].end + '"');
									E_GONE_FORWARD++;
								}
							}
							else	{
								console.log('Had "' + holes[k][holes[k].lodisStart ? 'lodisEnd' : 'end'] + '", got "' + res[0].end + '". No update of old splinters necessary.');
							}
							
							/* Calulates the area, for which the MINCORE is supposed to get recalculated. Also provides the
							paramters (G and P) to use in the process.*/
							const core = {
								v: holes[k].field,
								start: holes[k].lodisStart || holes[k].start,
								end: holes[k].lodisStart ? holes[k].lodisEnd : holes[k].end,
								g: G,
								p: P,
								lodis: holes[k].lodisStart ? holes[k].start : null,
							};

							// The requestz to send to the BatchSearchService. Orders for recrawls through TRENCH will get added later.
							let request = {
								parameter: {
									dig: [],
									core: core
								}
							};
							
							// Adds the recrawl orders created for the current hole to the request for the BatchSearchService.
							digOrders.forEach((el, ind) => {
								if(el.v === core.v && el.start < core.end 
										&& core.start < el.end && el.lodis === core.lodis)	{
									request.parameter.dig.push(el);
									digOrders.splice(ind, 1);
								}
							});
							
							/* Sort the recrawl ordesr ascending by volume dimension first, then the value on the volume dimension
							and then if necessary the value on the volume dimension enforcing unique values.*/
							request.parameter.dig.sort(function(a,b)	{
								a.v = a.v.toLowerCase();
								b.v = b.v.toLowerCase();
								if(a.v > b.v)	{
									return 1;
								}
								else if(a.v < b.v)	{
									return -1;
								}
								else	{
									a.start = a.start.toLowerCase();
									b.start = b.start.toLowerCase();
									if(a.start > b.start)	{
										return 1;
									}
									else if(a.start < b.start)	{
										return -1;
									}
									else	{
										a.lodisStart = a.lodisStart.toLowerCase();
										b.lodisStart = b.lodisStart.toLowerCase();
										if(a.lodisStart > b.lodisStart)	{
											return 1;
										}
										else if(a.lodisStart < b.lodisStart)	{
											return -1;
										}
									}
								}
							});

							// Combines directly neigbouring recrawl orders into one.
							console.log('.');
							console.log('--- COMBINE DIG ORDERS ---');
							for(var j=0; j < request.parameter.dig.length; j++)	{
								if(j < request.parameter.dig.length - 1 && request.parameter.dig[j].v === request.parameter.dig[j+1].v)	{
									
									// Gets the current and the directly followi ng recrawl orders.
									const digJ = request.parameter.dig[j];
									const digJ1 = request.parameter.dig[j+1]
									
									/* Checks if the areas covered by the current and the following recrawl order directly neighbour each other. If yes, absorb the next recrawl order's range into the current ones. Decrease the counter so that the current recrawl order gets checked against its new following recrawl order.*/
									if(!digJ.lodisStart && !digJ1.lodisStart && (digJ.end == null || digJ.end >= digJ1.start))	{
										request.parameter.dig[j].end = digJ.end < digJ1.end || digJ1.end === null ? digJ1.end : digJ.end;
										request.parameter.dig.splice(j + 1, 1);
										j--;
									}
									/* Same check as above, but on the dimension enforcing unique values. Requires the field lodisStart to be set on both recrawl orders, which tells that both cover a LODIS-area.*/
									else if(digJ.start === digJ1.start && digJ.lodisStart && digJ1.lodisStart && (digJ.lodisEnd === null || digJ.lodisEnd >= digJ1.lodisStart))	{
										request.parameter.dig[j].lodisEnd = digJ.lodisEnd < digJ1.lodisEnd || digJ1.lodisEnd === null ? digJ1.lodisEnd : digJ.lodisEnd;
										request.parameter.dig.splice(j + 1, 1);
										j--;
									}
									// No merge was executed.  Log the final hole.
									else if(!digJ.lodisStart)	{
										console.log('Created combined dig order: (' + digJ.start + ' -> ' + digJ.end + ')');
									}
									else	{
										console.log('Created combined LODIS dig order: (' + digJ.start + ', ' + digJ.lodisStart + ' -> ' + digJ.lodisEnd + ')');					
									}
								}
							}
							
							// Log the last recrawl order.
							if(0 < request.parameter.dig.length)	{
								if(!request.parameter.dig[request.parameter.dig.length - 1].lodisStart)	{
									console.log('Created combined dig order: (' + request.parameter.dig[request.parameter.dig.length - 1].start + ' -> ' + request.parameter.dig[request.parameter.dig.length - 1].end + ')');
								}
								else	{
									console.log('Created combined LODIS dig order: (' + request.parameter.dig[request.parameter.dig.length - 1].start + ', ' + request.parameter.dig[request.parameter.dig.length - 1].lodisStart + ' -> ' + request.parameter.dig[request.parameter.dig.length - 1].lodisEnd + ')');					
								}
							}
							else	{
								console.log('No dig orders present.');
							}

							console.log(JSON.stringify(request));
							// Only proceeds with requests containing recrawl orders if the foreign Api-Key answered all previous queries.
							if(apiAnswers && request.parameter.dig.length > 0)	{

								// Sends the request to the BatchSearchService.
								const triggerBatchSearch = function()	{
									return new Promise(function(resolve2, reject2)	{
										BS.handler(request, null, function(err, data) {
											if(err)	{
												return reject2(err);
											}
											// "false" as the result set is the code to indicate that the foreign API locked down during TRENCH.
											if(data === false)	{
												console.log('Foreign API blocks! Abort update process');
											}
											else	{
												console.log('Batch Search Call completed');
											}
											
											FOREIGN_API_CALLS_ITERATION += data;
											FOREIGN_API_CALLS_TOTAL += data;
											DIGGING_FOREIGN_API_CALLS += data;
											DIGGINGS++;
											
											// Returns the result from the service as provided.
											return resolve2(data);
										});
									});
								};
								// Trigger the BatchSearchService. Remember if a foreign API lockdown occured during the last execution.
								apiAnswers = await triggerBatchSearch();
								return resolve(true);
							}
							// No recrawl orders where gathered for this hole. Only rebuild the MINCORE.
							else if(request.parameter.dig.length === 0)	{
								// Invoke the lambda.
								BS.handler(request, null, function(err, data) {
									if(err)	{
										return reject(err);
									}
									if(data === false)	{
										console.log('Foreign API blocks! Abort update process');
									}
									else	{
										console.log('Batch Search Call completed');
									}
									// Resolve the request.
									return resolve(data);
								});
							}
						});
					});
				}
				await executeFollowup();
			}
		}
		
		console.log('--- GET LOCAL ENTRIES ---');
		var dataQuery = 'SELECT * FROM u_loc_' + MOCK_NAME + ' WHERE ';		
		// Builds the query.
		for(let key in input)	{
			var LB;
			var UB;
			const ALPHABET = ALPHABET_MAP[key];
			// Resolves the provided user request to an actual range.
			LB = input[key].replace('*','');
			if(input[key].charAt(input[key].length - 1) !== '*')	{
				UB = LB + (ALPHABET[0] !== ' ' ? ALPHABET[0] : ALPHABET[0] + ALPHABET[1]);
			}
			else	{
				// Gets the next character as upper bound to mimic the range specified by a begins-with-filter.
				UB = getNextInAlphabet(input[key].replace('*',''), key);
			}
			
			// Narrows down the data returned by the query as specified by the currently processed part of the user request.
			dataQuery += mimicGreaterEqual(mysql.escape(LB), key) + ' AND ' + key + ' < ' + mysql.escape(UB) + ' AND ';
		}
		dataQuery = dataQuery.replace(/ AND $/, ';');
		console.log(dataQuery);
		
		// Fore the query
		const result = await new Promise((resolve, reject) => {
			dbConnection.query(dataQuery, function(err, res)	{
				if(err)	{
					return reject(err);
				}
				console.log('Found ' + res.length + ' entries');
				return resolve(res);
			});
		});

		// Returns the found entries.
		response = result || [];
	}
	// Error handling. Should be impossible to trigger.
	catch(e)	{
		wasError = true;
		response = {
			resultSet: []
		};
		console.log('Error: ' + JSON.stringify(e));
		console.log('Error message: ' + e.message);
		console.log('Error stack: ' + e.stack);
	}
	
	// Cut down the gathered entries to the values relevant for the user.
	var cutResponse = [];
	for(let i=0; i < response.length; i++)	{
		let newEntry = {};
		for(let j=0; j < COLUMNS_TO_SHOW.length; j++)	{
			newEntry[COLUMNS_TO_SHOW[j]] = response[i][COLUMNS_TO_SHOW[j]];
		}
		cutResponse[i] = newEntry;
	}
	
	console.log('Limited attributes to ' + COLUMNS_TO_SHOW.join(',') + ' for ' + cutResponse.length + ' entries.');
	
	// Provide the response in the format required by AWS lambda.
	response = {
		isBase64Encoded: false,
		statusCode: wasError || !apiAnswers ? 502 : 200,
		headers: {
			'Content-Type': 'application/json',
			'Access-Control-Allow-Headers':'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
			'Access-Control-Allow-Credentials' : true,
			'Access-Control-Allow-Origin': '*'
		},
		body: JSON.stringify(cutResponse)
	};
	
	callback(response);
}


/**
 *	Executes a provided query against the local database.
 *
 *	@param q: The query to execute as string.
 *	@returns the result as returned by the database.
 */
function simpleQuery(q)	{
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

let dbRes = 0;
/**
 *	Exectutes the update-process with a provide artificial day configuration.
 *
 *	@param ADpara: The artifical day as object. Must contain the following member:
			- GOLD_HOT_CALL_PERCENT: The percentage of calls deducted from interesting entries as number.
			- GOLD_PERCENT: The percentage of entries in the database to set as always-interesting as number.
			- HOT_PERCENT: The percentage of entries in the database to set as daily-interesting as number.
			- DAILY_CALLS: The amount of calls to execute each day as number.
			- INSERT_PERCENT: The percentage of entries to insert into the database after an artificial day. 
							  Percentage is calculated relative to the size of the local database at artificial day 0.
			- DEL_PERCENT: The percentage of entries to delete the database after an artificial day.
						   Percentage is calculated relative to the size of the local database at artificial day 0.
			- CALL_TYPE: 'GAUSSIAN' for normal completeness, something else for extensive completeness.
			- CSV: The name of the csv-file to write the results into as string.
 */
function cont(ADpara)	{

	return new Promise(async function(resolve0, reject0)	{
		const AD = ADpara;
		
		// Configure used libraries
		await config();
		
		if(LOCAL)	{
			// Reset the database tables for the evaluation.
			dbRes = await simpleQuery('TRUNCATE TABLE u_loc_' + MOCK_NAME + ';');
			dbRes = await simpleQuery('TRUNCATE TABLE hd_mock_' + MOCK_NAME + ';');
			dbRes = await simpleQuery('TRUNCATE TABLE splinter;');
			dbRes = await simpleQuery('TRUNCATE TABLE maintenancelist;');
			dbRes = await simpleQuery('TRUNCATE TABLE bank_' + MOCK_NAME + ';');
			
			// Load entries into the database
			DB = require('../scripts/loader.js');	
			if(MOCK_NAME !== 'landslides')	{
				dbRes = await DB.loadDB(smallDB ? 5280 : 9100);
			}
			else if(MOCK_NAME === 'landslides')	{
				dbRes = await DB.loadRealDB();
			}
			
			// Remove entries from the local database so that they can be used later to mimic data inserts.
			dbRes = await simpleQuery('CALL bank_transfer_' + MOCK_NAME + '(NULL);') 
		}
		
		
		let csv = ''//',TRENCH,MINCORE\r\n';
		if(!LOCAL)	{
			csv = 'DATE,CALLS,PURE_SYSTEM_TIME,FULL_RESPONSE_TIME';
		}
		
		/**
		 *	Performs a specified action through the BatchSearchService.
		 *
		 *	@param attr: The attribute on which the action shall get executed as string.
		 *	@param kind: The kind of action to execute as string. Valid kinds are:
						- 'core': Build a perfect MINCORE over the whole namespace.
						- 'dig': Perform TRENCH over the whole namespace.
						- 'dry': Perform TRENCH over the whole namespace, but saves entries into a new, 
								 temporary table and not the table used for the evaluation of MINCORE.
		 */
		const callBatchSearch = function(attr, kind)	{
			return new Promise(async function(resolve, reject)	{
				dbRes = await simpleQuery('TRUNCATE TABLE u_loc_dry_' + MOCK_NAME + ';');
				// Send the request for a BatchSearchService-execution.
				BS.handler({
					parameter: {
						dig: kind !== 'core' ? [{
							v: attr,
							start: ALPHABET_MAP[attr][0],
							end : new Array(10).fill(ALPHABET_MAP[attr][ALPHABET_MAP[attr].length - 1]).join(''),
							step: Math.ceil(G/2),
							g: G,
							lodis: null
						}] : null,
						core: kind !== 'core' ? null : {
							v: attr,
							start: ALPHABET_MAP[attr][0],
							end : new Array(10).fill(ALPHABET_MAP[attr][ALPHABET_MAP[attr].length - 1]).join(''),
							g: G,
							p: P,
							lodis: null
						},
						dry: kind === 'dry'
					}
				}, null, function(err, data) {
					// Measure for the evaluation how many queries a complete recrawl of the hidden database would have triggered.
					if(kind === 'dry')	{
						console.log('Added to TRENCH: ' + data);
						TRENCH_CALLS += data;
					}
					return resolve(true);
				});
			});
		};
		
		if(LOCAL)	{
			// Crawl the whole namespace once through TRENCH.
			dbRes = await callBatchSearch(CRAWL_DIM, 'dig');
			for(var i=0; i < ATTR_CYCLE.length; i++)	{
				// Create a MINCORE for every of the specified volume dimensions.
				dbRes = await callBatchSearch(ATTR_CYCLE[i], 'core');
			}
		}

		// Reset the measurements
		FOREIGN_API_CALLS_TOTAL = 0;
		TRENCH_CALLS = 0;
		FOREIGN_API_CALLS_ITERATION = 0;
		DIGGING_FOREIGN_API_CALLS = 0;
		DIGGINGS = 0;
		EXTENSIONS = 0;
		E_GONE_FORWARD = 0;
		FAILED_UPDATES = 0;
		INSTANT_UPDATES = 0;
		UPDATE_QUERY = 0;
		
		// Set the amount of artificial days tp evaluate.
		const DAYS = 11;
		// Iterate through the artificial days.
		for(var i= !LOCAL ? DAYS - 1 : 0; i < DAYS; i++)	{
			
			TIME_TOTAL = 0;
			TIME_PAUSE = 0;
			TIME_RESPONSE_TIME = 0;
		
			let calls = AD.DAILY_CALLS;
			if(LOCAL)	{
				calls = await prepareAD(AD, i === 0);
			}
			else	{
				// Some example calls.
				calls = [ 'andre*',
						  'berrios *',
						  'cra*',
						  'gat*' ]}
		
			console.log('Day ' + (i+1));
			
			// Every three artificial days, check how many queries a complete recrawl through TRENCH would require.
			if(LOCAL && i > 0 && i % 3 === 0)	{
				const x = await callBatchSearch(UNIQUE_IDENTIFICATOR, 'dry');
			}
			
			// Setup a conenction to the LDAP foreign API.
			if(!LOCAL)	{
				await connectToLdapForeignApi();
			}			
			var processStart = Date.now();
			// Process the calls.
			for(var j=0; j < calls.length; j++)	{
				console.log('');
				console.log('Call #' + j + ': ' + calls[j]);
				const val = ATTR_CYCLE[j % ATTR_CYCLE.length];
				// Set the search term into the corresponding attribute.
				let qu = {};
				qu[val] = calls[j];
				// Call the system with the created user request.
				await exports.handler({
					queryStringParameters: qu
				},{}, function() {});
			}
			
			// Log the measurements for this artificial day.
			if(LOCAL)	{
				switch(cc)	{
					case 'New1_':
					case 'New11_':
					case 'New2_':
					case 'New21_':
					case 'New22_':
					case 'New3_':
					csv += '(' + (i+1) + ',' + TRENCH_CALLS  + ',' + FOREIGN_API_CALLS_TOTAL + ')\r\n';
					break;
					default:
					csv += '(' + (i+1) + ',' + UPDATE_QUERY + ',' + FOREIGN_API_CALLS_TOTAL + ',' + INSTANT_UPDATES + ',' + FAILED_UPDATES + ')\r\n';
					break;
				}
			}
			else	{
				csv += '(' + (new Date()).getDay() + ',' + FOREIGN_API_CALLS_TOTAL + ',' + TIME_RESPONSE_TIME + ',' + TIME_PAUSE + ')\r\n';
			}
			
			// Finalize the measured times.
			TIME_TOTAL = Date.now() - processStart - TIME_TOTAL;
			let TIME_SYSTEM = TIME_TOTAL - TIME_RESPONSE_TIME - TIME_PAUSE;
			
			// Print the measurements.
			console.log('Day ' + i + ' done');
			console.log('');
			console.log('');
			console.log('FOREIGN_API_CALLS: ' + FOREIGN_API_CALLS_TOTAL);
			console.log('FOREIGN_API_CALLS_ITERATION: ' + FOREIGN_API_CALLS_ITERATION);
			console.log('DIGGINGS: ' + DIGGINGS);
			console.log('EXTENSIONS: ' + EXTENSIONS);
			console.log('E_GONE_FORWARD: ' + E_GONE_FORWARD);
			console.log('DIGGING_FOREIGN_API_CALLS: ' + DIGGING_FOREIGN_API_CALLS);
			console.log('INSTANT_UPDATES: ' + INSTANT_UPDATES);
			console.log('FAILED_UPDATES: ' + FAILED_UPDATES);
			console.log('TIME_TOTAL: ' + TIME_TOTAL);
			console.log('TIME_PAUSE: ' + TIME_PAUSE);
			console.log('TIME_RESPONSE_TIME: ' + TIME_RESPONSE_TIME);
			console.log('TIME_SYSTEM: ' + TIME_SYSTEM);
			console.log('');
			console.log('');
			console.log('');
			console.log('');
			
			// Artifically process one day in the local database.
			dbRes = await simpleQuery('UPDATE splinter SET TIMESTAMP = TIMESTAMP - INTERVAL 1 DAY;');
			FOREIGN_API_CALLS_ITERATION = 0;
		}
		
		// Close all connections
		if(!LOCAL)	{
			ldapConnection.unbind();
		}
		dbConnection.end();
		
		// Write the measured results into a csv-file.
		const fs = require('fs');
		fs.writeFile((!LOCAL ? 'NCSU_' : (typeof cc === 'number' ? 'New4_' : '') + cc + '') + AD.CSV , csv, function(err) {
			if(err) {
				return reject0(err);
			}
			return resolve0(true);
		});
	});
}

let oCount;
let gold = [];
let hot = [];
let gh = [];
let cc = 0;

/**
 *	Simulates the actions expected to happen on one day and Calculates the artificial user requests for the next MICNORE run.
 *
 *	@param c: The artificial day configuration to use as base for calculations. Same format as for function cont().
 *	@param first: A boolean indicating if this is the first call of the method since the start of the evaluation. If true, then some
				  additional configurations will get performed.
 */
function prepareAD(c, first)	{
	
	return new Promise(async function(resolve, reject)	{
		
		/* Sets up always-interesting (=gold) entries for this evaluation. Remembers the initial size of the local database for future
			calculation with percentage values. */
		if(first)	{
			oCount = await simpleQuery('SELECT COUNT(*) AS a FROM hd_mock_' + MOCK_NAME + ';');
			// Remember the initial size of the local database.
			oCount = oCount[0].a;
			// Calculate and get the always-interesting entries.
			dbRes = await simpleQuery('UPDATE hd_mock_' + MOCK_NAME + ' SET gold = 1 ORDER BY RAND() LIMIT ' + Math.ceil(oCount / 100 * c.GOLD_PERCENT));
			gold = await simpleQuery('SELECT * FROM hd_mock_' + MOCK_NAME + ' WHERE gold = 1;');
		}
		
		//Select the daily interesting entries for the next artificial day.
		hot = await simpleQuery('SELECT * FROM hd_mock_' + MOCK_NAME + ' WHERE gold = 0 ORDER BY RAND() LIMIT ' + Math.ceil(oCount / 100 * c.HOT_PERCENT));
		gh = gold.concat(hot);
		
		// Insert into and delete from the local database entries as specified by the artificial day configuration.
		dbRes = await simpleQuery('CALL db_transfer_' + MOCK_NAME + '(' + Math.ceil(oCount / 100 * c.INSERT_PERCENT) + ');');
		dbRes = await simpleQuery('CALL bank_transfer_' + MOCK_NAME + '(' + Math.ceil(oCount / 100 * c.DEL_PERCENT) + ');');
		
		// Calculate the amount calls to calculate from interesting and non-interesting entries.
		let goldCalls = Math.floor(c.DAILY_CALLS / 100 * c.GOLD_HOT_CALL_PERCENT);
		let remCalls = c.DAILY_CALLS - goldCalls;
		
		// Choose the entries to calculate queries from for each kind.
		let remArray = await simpleQuery('SELECT * FROM hd_mock_' + MOCK_NAME + ' ' + (c.GOLD_HOT_CALL_PERCENT > 0 ? 'WHERE gold = 0' : '') + ';');
		let remSelection = [];
		for(let j=0; j < remCalls; j++)	{
			remSelection.push(remArray[Math.floor(Math.random() * remArray.length)]);
		}
		let goldSelection = [];
		if(c.GOLD_HOT_CALL_PERCENT > 0)	{
			for(let j=0; j < goldCalls; j++)	{
				goldSelection.push(gh[Math.floor(Math.random() * gh.length)]);
			}
		}
		else	{
			goldCalls = [];
		}
		
		// Calculate the actual entries according to the specified completeness.
		let allCalls = goldSelection.concat(remSelection).map((el,ind) => {
			
			/* Calculates the search term from the attribute used at this index during the execution
			of MINCORE to create the user request.*/
			let attr = ATTR_CYCLE[ind % ATTR_CYCLE.length];
			el = el[attr];
			// Extensive completeness.
			if(c.CALL_TYPE !== 'GAUSSIAN')	{
				let point = Math.random();
				let c = 0.5;
				
				el = el + '*';
				while(2 < el.length && point < c)	{
					el.replace('*','').replace(/.$/,'*');
					c = c / 2; 
				}
			}
			// normal completeness.
			else	{
				const normalRand = function() {
					var u = 0, v = 0;
					while(u === 0) u = Math.random(); //Converting [0,1) to (0,1)
					while(v === 0) v = Math.random();
					let num = Math.sqrt( -2.0 * Math.log( u ) ) * Math.cos( 2.0 * Math.PI * v );
					num = num / 10.0 + 0.5; // Translate to 0 -> 1
					if (num > 1 || num < 0) return normalRand(); // resample between 0 and 1
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
		
		// Pass all splinter which are three days old or older into the maintenance list.
		dbRes = await simpleQuery('REPLACE INTO maintenancelist SELECT * FROM splinter WHERE TIMESTAMP <= NOW() - INTERVAL 3 DAY;');
		
		return resolve(allCalls);
	});
}



// 		-----------------------------------------
//		+++++ ARTIFICIAL DAY CONFIGURATIONS +++++
// 		-----------------------------------------
//
//		The different artificial day configurations 
//		used throughout the evaluation.


const AD_base_G100 = {
	GOLD_HOT_CALL_PERCENT: 20,
	GOLD_PERCENT: 1,
	HOT_PERCENT: 1,
	DAILY_CALLS: 100,
	INSERT_PERCENT: 3,
	DEL_PERCENT: 2,
	CALL_TYPE: 'GAUSSIAN',
	CSV: 'AD_base_G100.csv'
};
const AD_base_G10000 = {
	GOLD_HOT_CALL_PERCENT: 20,
	GOLD_PERCENT: 1,
	HOT_PERCENT: 1,
	DAILY_CALLS: 10000,
	INSERT_PERCENT: 3,
	DEL_PERCENT: 2,
	CALL_TYPE: 'GAUSSIAN',
	CSV: 'AD_base_G10000.csv'
};
const AD_base_E100 = {
	GOLD_HOT_CALL_PERCENT: 20,
	GOLD_PERCENT: 1,
	HOT_PERCENT: 1,
	DAILY_CALLS: 100,
	INSERT_PERCENT: 3,
	DEL_PERCENT: 2,
	CALL_TYPE: 'EXTENSIVE',
	CSV: 'AD_base_E100.csv'
};
const AD_base_E10000 = {
	GOLD_HOT_CALL_PERCENT: 20,
	GOLD_PERCENT: 1,
	HOT_PERCENT: 1,
	DAILY_CALLS: 10000,
	INSERT_PERCENT: 3,
	DEL_PERCENT: 2,
	CALL_TYPE: 'EXTENSIVE',
	CSV: 'AD_base_E10000.csv'
};
	
const AD_grow_G100 = {
	GOLD_HOT_CALL_PERCENT: 20,
	GOLD_PERCENT: 1,
	HOT_PERCENT: 1,
	DAILY_CALLS: 100,
	INSERT_PERCENT: 10,
	DEL_PERCENT: 1,
	CALL_TYPE: 'GAUSSIAN',
	CSV: 'AD_grow_G100.csv'
};
const AD_grow_G10000 = {
	GOLD_HOT_CALL_PERCENT: 20,
	GOLD_PERCENT: 1,
	HOT_PERCENT: 1,
	DAILY_CALLS: 10000,
	INSERT_PERCENT: 10,
	DEL_PERCENT: 1,
	CALL_TYPE: 'GAUSSIAN',
	CSV: 'AD_grow_G10000.csv'
};
const AD_grow_E100 = {
	GOLD_HOT_CALL_PERCENT: 20,
	GOLD_PERCENT: 1,
	HOT_PERCENT: 1,
	DAILY_CALLS: 100,
	INSERT_PERCENT: 10,
	DEL_PERCENT: 1,
	CALL_TYPE: 'EXTENSIVE',
	CSV: 'AD_grow_E100.csv'
};
const AD_grow_E10000 = {
	GOLD_HOT_CALL_PERCENT: 20,
	GOLD_PERCENT: 1,
	HOT_PERCENT: 1,
	DAILY_CALLS: 10000,
	INSERT_PERCENT: 10,
	DEL_PERCENT: 1,
	CALL_TYPE: 'EXTENSIVE',
	CSV: 'AD_grow_E10000.csv'
};




// Evaluation EV4
async function startNew1LSOneBase()	{
	
	cc = 'New11_';
	ATTR_CYCLE = ['event_title'];
	MOCK_NAME = 'landslides';
	LOCAL = true;
	
	await cont(AD_base_G100);
	await cont(AD_base_E100);
	await cont(AD_base_G10000);
	await cont(AD_base_E10000);
}

// DEPRACTED
async function startNew2NAMES10000OneGrow()	{
	
	cc = 'New2_';
	LOCAL = true;
	await cont(AD_grow_G100);
	await cont(AD_grow_G10000);
	
}


// Evaluation EV5
async function startNew22_30000()	{
	
	cc = 'New21_';
	smallDB = true;
	LOCAL = true;
	
	//await cont(AD_grow_G100);
	//await cont(AD_grow_G10000);
	cc = 'New22_';
	smallDB = false;
	await cont(AD_grow_G100);
	/*await cont(AD_grow_G10000);*/
}


// Evaluation EV6
async function startNew3MulitLSMultiBase()	{
	
	cc = 'New3_';
	MOCK_NAME = 'landslides';
	LOCAL = true;
	
	await cont(AD_base_G100);
	await cont(AD_base_E100);
	await cont(AD_base_G10000);
	await cont(AD_base_E10000);

}

// Evaluation EV7
async function startNew4POneBase()	{
	
	cc = 0;
	MOCK_NAME = 'landslides';
	ATTR_CYCLE = ['source_name'];
	LOCAL = true;
	
	await cont(AD_base_G100);
	P = 5;
	cc++;
	await cont(AD_base_G100);
	P = 0;
	cc++;
	await cont(AD_base_G100);
}

// Perform one artificial day against the LDAP foreign API.
async function startR()	{
	
	cc = 'NCSU_';
	MOCK_NAME = 'ncsu';
	ATTR_CYCLE = ['sn'];
	LOCAL = false;
	
	await cont(100);

}

// Use this to replicate EV4:
//startNew1LSOneBase();

// Use this to replicate EV5:
//startNew22_30000();

// Use this to replicate EV6:
//startNew3MulitLSMultiBase();

// Use this to replicate EV7:
//startNew4POneBase();