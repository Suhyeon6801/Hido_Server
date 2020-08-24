const path = require("path");
var http = require('http');
var https = require('https');
var fs = require('fs');
var express = require("express"); // npm install express
const request = require("request");
var mysql = require("mysql");
var crypto = require('crypto');
const aes256 = require('aes256'); // npm install aes256

//promise, pm2, async 사용법

var app = express();
app.use(express.json());

app.use(express.urlencoded({ extended: false }));//form에서 데이터를 받아오자!

app.set('views', __dirname + '/views');
app.set('view engine', 'ejs');

app.use(express.static(path.join(__dirname, "public"))); //to use static asset

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"; //crt의 self-signed 문제 해결

var key = fs.readFileSync('./keys/pr.pem', 'utf-8');
var certificate = fs.readFileSync('./keys/main_server.crt', 'utf-8');
var credentials = { key: key, cert: certificate };

//시간 출력
var newData = new Date();
var time = newData.toFormat('YYYY-MM-DD HH24:MI:SS');

//원래는 hidoDB가 아니라 key/certification/fingerprint DB 3개로 나눠줘야함.
//우선 hidoDB내에 table3개로 구성
var connection = mysql.createConnection({//local db
    host: "127.0.0.1", //localhost
    user: "root",
    password: "8603",
    database: "hido",
    port: "3306"
    // multipleStatements: true  // 다중쿼리용 설정
});
connection.connect();
// connection.release();

request.defaults({ //rejectUnauthorized를 false값으로 두어야 https 서버통신 가능
    strictSSL: false, // allow us to use our self-signed cert for testing
    rejectUnauthorized: false
});

//1. 서버 상태 확인.
app.get("/", function (req, res) {
    console.log("Server Time ["+ time +"] ACCESS - SUCCESS");
    var output = {
        "mode": "access",
        "result": "true"
    };
    console.log(output);
    res.send(output);
});

//4-1. 지문등록 유무 확인 요청
app.post("/registration/fingerprint", function (req, res) {//->post로

    console.log("Server Time ["+ time +"] REGISTER CHECK : " + "Session Key [" + req.body.session_key + "]  Running App Code [" + req.body.running + "]  IMEI [" + req.body.imei + "]");

    var session_key = req.body.session_key;
    var running = req.body.running;
    var imei = req.body.imei;

    //임시 값.(이미 등록된 지문)
    // var session_key = 'test';
    // var running = '007';
    // var hash_imei = '1234567';

    //임시 값(등록되지 않은 지문)
    // var session_key = '12345';
    // var running = '006';
    // var imei = '9876';//얘는 평문으로 들어옴.

    var hash_session_key = (crypto.createHash('sha512').update(String(session_key)).digest('base64'));//암호화
    var hash_imei = (crypto.createHash('sha512').update(String(imei)).digest('base64'));//암호화

    //4-2. 지문등록 유무확인 
    var sql = "SELECT * FROM hido.key WHERE IMEI = ? AND bankcode = ?";
    connection.query(
        sql, [hash_imei, running], function (error, results) {
            if (error) throw error;
            else {
                if (results.length == 0) {
                    console.log("Server Time ["+ time +"] REGISTER CHECK - SUCCESS");
                    //지문등록 하기

                    //4. 세션키로 A Bank Server에 CI요청
                    let option = {
                        method: 'POST',
                        url: "https://172.30.1.3:443/registration/fingerprint",
                        json: { "session_key": hash_session_key }
                    };

                    request(option, function (error, response, body) {
                        // console.error('error:', error);
                        // console.log('statusCode:', response && response.statusCode); 
                        console.log('body:', body);

                        if (!error && response.statusCode == 200) {
                            var data = body;
                            var CI = data.CI;//이미 암호화된 값.

                            //6. 지문등록 DB에 등록                 
                            var sql2 = "INSERT INTO fingerprint (`CI`, `curBankCode`, `sessionKey`) VALUES (?,?,?)";
                            connection.query(
                                sql2, [CI, running, hash_session_key], function (error, results2) {
                                    if (error) throw error;
                                    else {
                                        console.log("fingerprint DB insert");

                                        var output = {
                                            "mode": "register_check",
                                            "result": "true"
                                        }

                                        console.log(output);
                                        res.send(output);//2 
                                    }
                                });
                        }
                    });
                }
                else {
                    var dbimei = results[0].IMEI;
                    var dbBankCode = results[0].bankcode;

                    if (dbimei == hash_imei && dbBankCode == running) {
                        console.log("Server Time ["+ time +"] REGISTER CHECK - FAIL");

                        var output = {
                            "mode": "register_check",
                            "result": "false"
                        }

                        console.log(output);
                        res.send(output);
                    }
                }
            }
        });
});


//8.client에서 받은 publicKey 분할 ->추후에 client에서 받아오는 request문 작성해줘야함 + 암호화
app.post("/registration/key", function (req, res) {
    var temp = req.body.public_key;
    public_key = "-----BEGIN PUBLIC KEY-----" + "\n" + temp + "-----END PUBLIC KEY-----\n"; //publickey는 client을 거쳐서 넘어옴

    if (public_key != null) {
        var a = (public_key.length) / 2;
        global.publicKeyA = public_key.substr(0, a); //A는 hidoDB에 저장
        global.publicKeyB = public_key.substr(a,); //B는 fidoDB에 저장

        /*9.db 데이터 추가&삭제
        DB의 fingerprint table에서 은행코드, Session Key로 검색해서 CI 값 얻기
        CI와 연결된 PublicKeyA key table에 추가(update)*/
        console.log("Server Time ["+ time +"] REGISTRATION KEY (HIDO) : " + "Session Key [" + req.body.session_key
            + "]  Running App Code [" + req.body.running + "]  IMEI [" + req.body.imei + "]  Public Key [" + public_key + "]");

        var session_key = req.body.session_key;
        var bankcode = req.body.running;
        var imei = req.body.imei;

        var hash_session_key = (crypto.createHash('sha512').update(String(session_key)).digest('base64'));//암호화
        var hash_imei = (crypto.createHash('sha512').update(String(imei)).digest('base64'));//암호화

        var sql1 = "SELECT * FROM fingerprint WHERE sessionKey = ? AND curBankCode = ?;"
        connection.query(sql1, [hash_session_key, bankcode], function (error, results) {
            if (error) throw error;
            else {
                var dbCI = results[0].CI;
                console.log('CI 찾았다 -- > ', CI);

                var sql2 = "INSERT INTO hido.key (`CI`, `bankcode`, `publicKeyA`, `IMEI`) VALUES (?,?,?,?)"
                connection.query(sql2, [dbCI, bankcode, publicKeyA, hash_imei], function (error, results) {
                    if (error) {
                        throw error;
                    } else {

                        if (results.length == 0) {
                            console.log("Server Time ["+ time +"] REGISTRATION KEY - FAIL");
                            var output = {
                                "mode": "register_result",
                                "result": "false"
                            }
                            res.send(output);

                        } else {
                            console.log("Server Time ["+ time +"] REGISTRATION KEY - SUCCESS");
                            var output = {
                                "mode": "register_result",
                                "result": "true"
                            }
                            res.send(output);

                            let option = {
                                method: 'GET',
                                url: "https://172.30.1.48:443/registration/key",
                                json: { "publicKeyB": publicKeyB, "CI": dbCI }
                            }
                            request(option, function (error, response, body) {
                                console.log(body);
                            })
                        }
                    }
                });

            }
        });
    } else {
        console.log("error");
    }
});

/*========================= 지문 인증 프로세스 ======================================*/

//6. 사용자 인증
app.get("/fingerprint/valid", function (req, res) {

    var session_key = req.body.session_key;
    var imei = req.body.imei;
    var running = req.body.running;
    var saved = req.body.saved;

    var hash_session_key = (crypto.createHash('sha512').update(String(session_key)).digest('base64'));//암호화
    var hash_imei = (crypto.createHash('sha512').update(String(imei)).digest('base64'));//암호화

    console.log("Server Time ["+ time +"] FINGERPRINT VAILD : " + "Session Key [" + req.body.session_key + "]  Running App Code [" + req.body.running + "]  IMEI [" + req.body.imei + "]  Saved Bank code [" + req.body.saved + "]");

    //1.지문등록 유무 확인
    sql = "SELECT * FROM hido.key WHERE IMEI = ? AND bankcode = ? ";
    connection.query(
        sql, [hash_imei, running], function (error, results) {
            if (error) throw error;
            else {
                //2.지문정보 확인
                var dbimei = results[0].IMEI;
                var dbBankCode = results[0].bankcode;
                if (dbimei == hash_imei && dbBankCode == running) {
                    console.log("지문은 등록 되어있음.");

                    // //3.지문 등록 확인 결과 및 챌린지 넘버 전송
                    var CI = results[0].CI;

                    //certification DB 데이터 추가 
                    //session_key와 running으로 조회 : db에 없으면 추가 후 결과 true 반환, 이미 존재하면 이미 그건 지문등록 된 거 챌린지 넘버 조회해서 반환
                    sql_check = "SELECT * FROM certification WHERE useBankCode = ? AND sessionKey = ?";
                    connection.query(sql_check,[running, hash_session_key], function(error, results){
                        if(error)   throw error;
                        else{
                            if(results.length==0)
                            {
                                console.log("지문 등록은 되어있지만, 지문 인증dbms에는 아직 없다.");
                                var randomNum = String(Math.floor(Math.random() * 1000) + 1);//랜덤으로 챌린지 넘버 생성 
                                global.key = "fido";
                                var enChallengeNum = aes256.encrypt(key,randomNum); // 개인키로 암호화
                                console.log('enChallengeNum : ',enChallengeNum);

                                sql2 = "INSERT INTO certification (`CI`,`useBankCode`,`saveBankCode`, `sessionKey`,`challengeNum`) VALUE (?,?,?,?,?);"
                                connection.query(sql2, [CI, running, saved, hash_session_key, enChallengeNum], function (error, results) {
                                        if (error) throw error;
                                        else {
                                            console.log("Server Time ["+ time +"] FINGERPRINT VAILD - SUCCESS  /  Challenge number [" + enChallengeNum + "]");
                                            var output = {
                                                "mode": "fingerprint_valid",
                                                "result": "true",
                                                "challenge_number": randomNum
                                            };
                                            res.send(output);
                                        }
                                    });
                            }
                            else{
                                console.log("이미 인증된 지문입니다.");//db에서 challengeNum값만 가져와서 전달해준다.
                                var dbchallengeNum = results[0].challengeNum;
                                console.log("Server Time ["+ time +"] FINGERPRINT VAILD - SUCCESS  /  Challenge number [" + dbchallengeNum + "]");
                                var output = {
                                    "mode": "fingerprint_valid",
                                    "result": "true",
                                    "challenge_number": dbchallengeNum
                                };
                                res.send(output);
                            }
                        }
                    });
                }
                else {
                    console.log("Server Time ["+ time +"] FINGERPRINT VAILD - FAIL  /  Challenge number [NULL]");
                    var output = {
                        "mode": "fingerprint_valid",
                        "result": "false",
                        "challenge_number": null
                    };
                    res.send(output);
                }
            }
        });

});

//fido서버에 CI 보내고 publicKeyB 요청 + 사용자 검증
app.post("/auth", function (req, res) {
    var session_key = req.body.session_key;
    var imei = req.body.imei;
    var running = req.body.running;
    var saved = req.body.saved;
    var signChallengeNum = req.body.challenge_number;
    var hash_session_key = (crypto.createHash('sha512').update(String(session_key)).digest('base64')); //해시

    //certificationDB에서 useBankCode, sessionKey 검색해서 CI획득
    var sql = "SELECT * FROM certification WHERE useBankCode = ? AND sessionKey = ?";
    connection.query(sql, [running, hash_session_key], function (error, results) {
        if (error) throw error;
        else {
            var CI = results[0].CI;
            let option = {
                method: 'POST',
                url: "https://172.30.1.48:443/auth",
                json: { "CI": CI }
            };

            request(option, function (error, response, body) {
                console.log('body:', body);

                if (!error && response.statusCode == 200) {
                    var data = body;
                    console.log(data);
                    //이미 다 hash된 값이 넘어옴.
                    var publicKeyB = data.publicKeyB;

                    if (CI != null) {//KeyDB에서 CI,useBankCode로 KeyA 획득
                        var sql = "SELECT * FROM hido.key WHERE CI = ? AND bankcode = ?";
                        connection.query(sql, [CI, running], function (error, results) {
                            if (error) throw error;
                            else {
                                var publicKeyA = results[0].publicKeyA;
                                var publicKey = publicKeyA + publicKeyB//KeyA+keyB로 완벽한 publicKey 획득
                                console.log(publicKey);

                                var sql2 = "SELECT * FROM certification WHERE CI = ? AND useBankCode = ?";
                                connection.query(sql2, [CI, running], function (error, results) {
                                    if (error) throw error;
                                    else {         
                                        var dbchallengeNum = results[0].challengeNum;
                                        var pu = fs.readFileSync('./keys/pu.pem', 'utf-8');
                                        var deChallengeNum = aes256.decrypt(key,dbchallengeNum);
                                        console.log("deChallengeNum : " + deChallengeNum.toString() + "\n");

                                        if (publicKeyB != null) {//publickeyB를 certDB에 저장(인증후 삭제)
                                            var sql = "UPDATE hido.key SET publicKeyB = ? WHERE CI = ?";
                                            connection.query(sql, [publicKeyB, CI], function (error, results) {
                                                if (error) throw error;
                                                else {
                                                    console.log("update key table");

                                                    /*챌린지넘버 복호화 후, 해시시켜서 certDB에 저장된 챌린지넘버와 비교
                                                    HIDO 서버가 bankapp서버에 인증 결과 전송 */
                                                   
                                                    var sql = "SELECT * FROM certification WHERE CI = ?";
                                                    connection.query(sql, [CI], function (error, results) {
                                                        if (error) throw error;
                                                        else {                                                         
                                                            const verifier = crypto.createVerify('sha256WithRSAEncryption');
                                                            verifier.update(deChallengeNum);
                                                            if (verifier.verify(publicKey, Buffer.from(signChallengeNum,'base64'))) {
                                                                console.log("Server Time ["+ time +"] AUTHENTICATION & TRANSFER: " + "Session Key [" + sessionKey + "]  Use App Code [" + useBankCode
                                                                    + "]  IMEI [" + hash_IMEI + "]  Saved Bank code [" + saveBankCode + "]  Challenge number [" + challengeNum + "]");

                                                                sql2 = "UPDATE hido.key SET publicKeyB = ? WHERE CI = ?"
                                                                connection.query(sql2, [" ", CI], function (error, results) {
                                                                    if (error) throw error;
                                                                    else {                                                                        
                                                                        console.log("publicKeyB destoryed");
                                                                    }
                                                                });

                                                                var output = {
                                                                    "mode": "auth",
                                                                    "result": "true"
                                                                }
                                                                res.send(output);
                                                            } else {
                                                                console.log("Server Time ["+ time +"] AUTHENTICATION - FAIL");
                                                                var output = {
                                                                    "mode": "auth",
                                                                    "result": "false"
                                                                }
                                                                res.send(output);
                                                            }
                                                        }
                                                    });
                                                }})
                                        } else {
                                            console.log("publickeyB 없음");
                                        }
                                    }
                                });
                                    }
                                });
                            } 
                            else { console.log("CI없음"); }           
                }
            });
                    
        }
    })
});

var httpsServer = https.createServer(credentials, app);
httpsServer.listen(443);
console.log('Server running');