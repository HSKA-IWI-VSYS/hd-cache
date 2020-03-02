# AWS-Cloud Implementation

The files found in this folder are versions of the Batch Search Service and the Processing Service for AWS. The code of each file is supposed to be run in a separate NodeJS-Lambda. Unfortunately, we can't provide an automated script to setup all necessary AWS-services the system requires. However, we will conclude in the following all steps necessary to get the system running.

## Setup

Please execute the following steps to setup the environment for the system:

1. Create an *AWS API Gateway* including one path. Enabling CORS may be necessary if requests are sent from an external source, like a non-AWS webapp. The path needs to be set up with *Lambda Integration* pointing towards the *Processing-Service-Lambda*, so requests get forwarded.

2. Create an *Identity Pool* in *AWS Cognito* and, at least, one user in it. Set the created Identity Pool as the *Authorizer* for the AWS API Gateway path created in step 1.

3. Create two *NodeJS Lambda* functions in *AWS Lambda*. Create two folders that both contain a copy of the `node_modules` folder created when installing `ldapjs` and `mysql` via npm. Copy the files `BatchSearchServiceAWS.js` and `ProcessingServiceAWS.js` into the folders so that each folder contains one of the files. Rename the files to `index.js` in the corresponding folders. Compress both folders into a `.zip`-file and upload them into their corresponding lambda functions.

4. Create a MariaDB database in the *AWS Relational Database Service* (AWS). Load the provided database-image into the database. Insert the location as well as login-credentials for the database into the function `connectToDB()` in the code of both lambdas.

5. Copy the ARN of the lambda containing the Batch-Search-Service and put it into line 1773 of the Processing-Service source code replacing attribute value `TO_SET` in the `params` object literal:

    ```javascript
    var params = {
        FunctionName: 'TO_SET',
        Payload: JSON.stringify(request)
    };
    ```

6. Use the same VPC security group whenever it is requested and make sure that it allows inbound traffic through ports `443` and `3306` and outbound traffic to everywhere (`0.0.0.0`).

7. Grant the AWS IAM role associated with your lambdas the permission `AWSLambdaFullAccess` (you should use the same role for both).

8. Put all elements introduced so far into the same VPC (only if the element can be positioned into a VPC at all) and make sure that it is connected to an Internet Gateway.

    **IMPORTANT:** This is a working, but insecure solution and will expose your VPC on the public internet. Make sure that you properly secured the components inside your VPC and don't return any confidential data via the lambda functions.

    A more secure way of gaining internet access would be to create a public VPC and a separate private VPC and connect them through a NAT-Gateway. However, this configuration is more difficult to setup and prone to configuration errors. More information about this way of gaining internet access can be found at <https://medium.com/@philippholly/aws-lambda-enable-outgoing-internet-access-within-vpc-8dd250e11e12> and various other tutorials online.  

## Usage

### Batch Search Service

The Batch Search Service is configured to work with the Processing Service as described in the corresponding paper. To trigger the initial crawl of the Batch-Search-Service through TRENCH, uncomment the code in lines 1496-1516 and fill the values:

 ```javascript
event = {
    parameter: {
        dig: [{
            v: 'sn',
            start: 'a',
            end : 'c',
            step: 250,
            g: 500,
            lodis: null
        }],
        core: {
            v: 'sn',
            start: 'a',
            end : 'c',
            g: 500,
            p: 10,
            lodis: null
        },
        mode: 'T'
    }
};
 ```

Chose the values according to your attributes domain (`v`=namespace to crawl, `start`=lower bound of the crawl range, `end`=upper bound of the crawl range) and foreign API characteristics (`g`=limiting value, `step`=TRENCH-progression (we recommend g/2), `p`=buffer value for splinter).
  
The objects `core` and `dig` need to contain the same values for the same attributes and `lodis` needs to be `null` for the initial crawl. It is **important** to comment out the lines 1496-1516 again, once the initial crawl through TRENCH is done.

### Processing Service

The Processing Service expects requests as *query parameter*. The key of each parameter is an attribut to filter and the value is the corresponding filter-value. Filtering is performed by exact-matching or begins-with-matching if an asterisk (\*) character is provided at the end of the search term.

For testing purposes, requests can be directly inserted through the testing-functionality of API-Gateway or by writing them directly as code into the Processing-Service-Lambda event-object.

## Reproducing the Results

 Since we evaluated the live system against a changing, real dataset, it will not be possible to reproduce the exact results as we provide them in the corresponding paper. However, one can perform an individual version of this evaluation by crawling the range \[a,h\) through TRENCH with the Batch-Search-Service as we did and then by performing 100 calls each day. Calls can be generated by the script `createCalls.js` in the scripts folder.

## Practical Notes - Please Read Carefully

Some additional note as regards the general usage of the system.

- Public, free-for-everyone LDAP-directories like NCSU provide their data in good faith. Please query the API responsibly and avoid unnecessary high query call-frequencies whenever possible, to keep the directory open and public for future researchers.

- Once triggered, a lambda will only be terminated once it finished its code. It is not possible to kill a lambda process manually. Please keep this in mind when performing changes to the system.

- AWS Lambda enforces a maximum runtime of 15 Minutes for one lambda call. While this timespan is sufficient for small and medium sized hidden databases (for example, crawling the approximately 14000 entries from NCSU took about 5m 30s), the time limit may run out for huge hidden databases. 
 
    We included a prototypical procedure to restart the Processing-Service-Lambda when necessary, which effectively resets the timer. However, this procedure is not tested since all our requests finished way before the 15 Minute limit was reached. It is **NOT** encouraged to use the restart-procedure as is and we highly recommend to thoroughly test and adapt it **BEFORE** using it in the cloud. Otherwise, one could erroneously create an almost unstoppable lambda. This is because the lambda will restart itself when necessary, thus running effectively forever if the exit condition is wrong.
