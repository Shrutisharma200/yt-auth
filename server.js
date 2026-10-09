import app from "./src/app.js";
import connectToDB from "./src/config/database.js";

import dns from "dns";

dns.setServers(["8.8.8.8", "8.8.4.4"]);

connectToDB();


app.listen(3000, () =>{
    console.log("Server is running on port 3000");
})