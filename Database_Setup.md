Install MariaDB docker
```bash
# creates a new mariadb database container
# and executes the provided sql
# ${PWD} should work on linux and powershell(Windows)
docker run --name hd-cache-db -e MYSQL_ROOT_PASSWORD=rootroot -v  ${PWD}/hd_mock_replication_image.sql:/docker-entrypoint-initdb.d/sql_dump_file.sql -p 3306:3306 -d mariadb:latest

# stop and delete the container
docker stop hd-cache-db
docker rm hd-cache-db
```
