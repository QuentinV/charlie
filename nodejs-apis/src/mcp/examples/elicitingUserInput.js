/*
Eliciting User Input
MCP servers can request additional information from users through the elicitation feature. 
This is useful for interactive workflows where the server needs user input or confirmation:
*/

// Server-side: Restaurant booking tool that asks for alternatives
server.tool(
  "book-restaurant",
  { 
    restaurant: z.string(),
    date: z.string(),
    partySize: z.number()
  },
  async ({ restaurant, date, partySize }) => {
    // Check availability
    const available = await checkAvailability(restaurant, date, partySize);
    
    if (!available) {
      // Ask user if they want to try alternative dates
      const result = await server.server.elicitInput({
        message: `No tables available at ${restaurant} on ${date}. Would you like to check alternative dates?`,
        requestedSchema: {
          type: "object",
          properties: {
            checkAlternatives: {
              type: "boolean",
              title: "Check alternative dates",
              description: "Would you like me to check other dates?"
            },
            flexibleDates: {
              type: "string",
              title: "Date flexibility",
              description: "How flexible are your dates?",
              enum: ["next_day", "same_week", "next_week"],
              enumNames: ["Next day", "Same week", "Next week"]
            }
          },
          required: ["checkAlternatives"]
        }
      });

      if (result.action === "accept" && result.content?.checkAlternatives) {
        const alternatives = await findAlternatives(
          restaurant, 
          date, 
          partySize, 
          result.content.flexibleDates as string
        );
        return {
          content: [{
            type: "text",
            text: `Found these alternatives: ${alternatives.join(", ")}`
          }]
        };
      }
      
      return {
        content: [{
          type: "text",
          text: "No booking made. Original date not available."
        }]
      };
    }
    
    // Book the table
    await makeBooking(restaurant, date, partySize);
    return {
      content: [{
        type: "text",
        text: `Booked table for ${partySize} at ${restaurant} on ${date}`
      }]
    };
  }
);

/// Client
// This is a placeholder - implement based on your UI framework
async function getInputFromUser(message: string, schema: any): Promise<{
  action: "accept" | "decline" | "cancel";
  data?: Record<string, any>;
}> {
  // This should be implemented depending on the app
  throw new Error("getInputFromUser must be implemented for your platform");
}

client.setRequestHandler(ElicitRequestSchema, async (request) => {
  const userResponse = await getInputFromUser(
    request.params.message, 
    request.params.requestedSchema
  );
  
  return {
    action: userResponse.action,
    content: userResponse.action === "accept" ? userResponse.data : undefined
  };
});