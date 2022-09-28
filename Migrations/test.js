class temp {


    hatml = 
    buildMOdal(className, header, body){

        `
        Copy
        <div class="modal" tabindex="-1" role="dialog" ${className}>
          <div class="modal-dialog" role="document">
            <div class="modal-content">
              <div class="modal-header">
                ${ buildheader(header)}
                <button type="button" class="close" data-dismiss="modal" aria-label="Close">
                  <span aria-hidden="true">&times;</span>
                </button>
              </div>
              <div class="modal-body">
               ${body}
              </div>
              <div class="modal-footer">
                <button type="button" class="btn btn-primary">Save changes</button>
                <button type="button" class="btn btn-secondary" data-dismiss="modal">Close</button>
              </div>
            </div>
          </div>
        </div>`

    }

    buildheader(title){
        return ` <h5 class="modal-title">${title}</h5>`
    }
}