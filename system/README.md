# Local Implementation

The files found in this folder represent a local version of the Processing-Service and the Batch-Search-Service. The code is of course not an exact duplicate of the code found in the AWS implementation. However, we tried hard to use the same code in both versions wherever possible and to keep code differences at an absolute minimum.

The files `BatchSearchTest.js` and `ProcessingTest.js` where used to create the results for the evaluations `EV1-EV7` (see paper). The code in `batchSearch.js` is used during `EV4-EV7` whenever the Processing Service (see `ProcessingTest.js`) needs to outsource ressource-consuming tasks to the Batch Search Service.

## Setup

The following (rough) steps are necessary to set up the system:

- Create a MariaDB database.
- Load the provided database-image into the database.
- Insert the location as well as login-credentials for the database into the function `connectToDB()` in the code of all JS-scripts in this folder.
- Make sure that the location and credentials are also present in all files of the `scripts`-folder.

## Usage

 In general, there are no further steps necessary to use the local system then calling the corresponding test-configuration as function through node.js, and setting the variable `MOCK_NAME` to the value `"landslides"` when using an evaluation with the `LANDSLIDES` dataset (EV2, EV4, EV6, EV7) and `"names"` when using an evaluation with an `NAMES_x` dataset (EV1, Ev3, EV5).

## Replicating the Results

 In detail, the evaluation results in the paper were gathered through the following functions:

- **EV1:** `contU()` in `BatchSearchTest.js`
- **EV2:** `contg()` in `BatchSearchTest.js`
- **EV3:** `contUg()` in `BatchSearchTest.js`
- **EV4:** `startNew1LSOneBase()` in `ProcessingTest.js`
- **EV5:** `startNew22_30000()` in `ProcessingTest.js`
- **EV6:** `startNew3MulitLSMultiBase()` in `ProcessingTest.js`
- **EV7:** `startNew4POneBase()` in `ProcessingTest.js`

 The results will be written into corresponding `.csv`-files.

 **Important!** Before running an evaluation found in `BatchSearchTest.js`, it is necessary to truncate the following tables (delete the data inside the table, but not the table itself):

- `hd_mock_landslides` and `u_loc_landslides` (only for EV2)
- `hd_mock_names` and `u_loc_names` (only for EV1 and EV3)
- `splinter`

 There are no truncations necessary when using the evaluations found in `ProcessingTest.js`, since this script automatically empties all required database tables before it runs its evaluations.

## Notes for Validation

 Please note that the system as well as its problem context contain *pseudo-random elements*. Thus, it is likely that newly gathered results vary slightly from the ones that were found for the paper.
