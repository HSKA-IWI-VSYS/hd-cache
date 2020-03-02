# A Third-Party Replication Service for Dynamic Hidden Databases

This repository contains algorithms for the replication of dynamic hidden databases as well as datasets to evaluate the efficiency of the approach. A detailed description of the underlying concepts can be found in the following paper:

- Stefan Hintzen, Yves Liesy and Christian Zirpins, "A Third-Party Replication Service for Dynamic Hidden Databases".

The files in repository were used to perform the evaluations found in the paper and can be used to replicate its results.

## Structure

This repository contains the following files and folders:

**landslides.csv:**
The dataset `LANDSLIDES` (details in the paper).

**names.csv:**
The dataset `NAMES` serves to calculate artificial datasets `NAMES_x`.

**package.json:**
This file specifies the node-packages necessary to run the files found in this paper. In detail, the project uses the packages `mysql` to connect to the MariaDB database and `ldapjs` to make LDAP-calls. The AWS-version of our system also uses the `AWS-SDK` package, which is automatically included in every lambda-function run in AWS Lambda. In general, it is necessary that all JS-scripts have access to the packages via `require(PACKAGE_NAME)`.

**package-lock.json:**
The dependency tree created when installing the packages specified in `package.json`.

**LICENSE.txt:**
The license this project is published with (Apache License, Version 2.0).

**hd_replication_db_image.sql:**
The image of a database containing all tables and stored procedures used by our system.

### scripts

The `scripts`-folder contains JS-scripts, that are not directly part of the system, but necessary for the setup of evaluations. In detail, those are:

**createCalls.js:**
Can create a number of search terms with respect to *normal* and *extensive completeness* (see paper for details).

**loader.js:**
Fills the mock hidden databases with data from a given dataset. It calculates the entries exactly as specified in the paper. Required to run `BatchSearchTest.js` and `ProcessingTest.js`.

### system

The `system`-folder contains the JS-scripts implementing the proposed system. In detail those are:

**BatchSearchTest.js:**
Implements the *Batch Search Service* and a wrapper to execute the service effectively according to the evaluation specifications. This file can be used to perform the evaluations EV1-EV2, EV3 (see paper).

**ProcessingTest.js:**
Implements the Processing Service and a wrapper to execute the service effectively according to the evaluation  specifications. This file can be used to perform the evaluations EV4-EV7 (see paper).

**batchSearch.js:**
An implementation of the Batch Search Service. It is unwrapped and callable from external sources. The script is used in `ProcessingTest.js` whenever the Batch Search Service is required during the update process.

### AWS

This folder contains an implementation of the system that can run in the context of the AWS cloud. Its content can be used to perform the field test on the basis of an open NCSU LDAP service (see paper section 6.4). In detail, it includes the following files:

**BatchSearchServiceAWS.js:**
An implementation of the Batch Search Service for AWS.

**ProcessingServiceAWS.js:**
An implementation of the Processing Service for AWS.

## Setup and Usage

Instructions to setup and run the different files in this system are given in the README-file of the sub folders. 

For reproducing the evaluations found in the paper proceed with the folder `system`.

## License and Copyright

```plaintext
Copyright 2020 Stefan Hintzen

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions
```
