const cron = require('node-cron');

class CronGroupManager {
    constructor(pool, sessionManager) {
        this.pool = pool;
        this.sessionManager = sessionManager;
        this.isProcessing = false; // Mutex untuk mencegah overlapping cron job
    }

    async initCrons() {
        console.log("Initializing cron group jobs...");
        cron.schedule("*/1 * * * *", async () => {
            if (this.isProcessing) {
                console.log("Cron is still running, skipping this cycle...");
                return;
            }
            this.isProcessing = true;
    
            try {
                console.log("Running cron job to fetch and insert groups with /register messages from sessions...");
                const sessions = this.sessionManager.getAllSessions();
    
                for (const [key, session] of Object.entries(sessions)) {
                    const deviceKey = key;
                    try {
                        const client = session.socket;
    
                        if (!client) {
                            console.log(`Device ${deviceKey} is not connected. Skipping...`);
                            continue;
                        }
    
                        // Fetch semua grup yang bot ikuti
                        const participatingGroups = await client.groupFetchAllParticipating();
                        console.log(`Found ${Object.keys(participatingGroups).length} participating groups for device ${deviceKey}`);
    
                        for (const [groupId, groupData] of Object.entries(participatingGroups)) {
                            try {
                                // Ambil pesan terbaru dari grup
                                const messages = await client.loadMessages({
                                    chatId: groupId,
                                    limit: 50,
                                });
    
                                // Periksa apakah ada pesan "/register"
                                const hasRegisterMessage = messages.some(msg => msg.body === "/register");
    
                                if (hasRegisterMessage) {
                                    // Bersihkan ID grup dengan menghapus "@g.us"
                                    const cleanGroupId = groupId.replace("@g.us", "");
                                    const groupName = groupData.subject || "Unknown Group";
    
                                    console.log(`Group ID: ${cleanGroupId}`);
                                    console.log(`Group Name: ${groupName}`);
    
                                }
                            } catch (groupError) {
                                console.error(`Error processing group ${groupId}:`, groupError.message);
                            }
                        }
                    } catch (sessionError) {
                        console.error(`Error processing session ${deviceKey}:`, sessionError.message);
                    }
                }
            } catch (error) {
                console.error("Error in cron job:", error.message);
            } finally {
                this.isProcessing = false;
            }
        });
    }
}

module.exports = CronGroupManager;
